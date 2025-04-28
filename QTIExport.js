/**
 *  QTIExport.gs – IMS QTI v1.2 Exporter
 *  ------------------------------------------------------------------
 *  Generates a QTI 1.2 compliant package (.zip) containing an imsmanifest.xml,
 *  an assessment XML, individual item XML files, and image resources.
 */

// Dependencies:
// - Utilities.gs (sanitizeHtml, replaceImagePlaceholdersWithHtml, QTI_RESOURCES_PATH, XML_MIME)
// - Constants.gs (QUESTION_TYPES)

'use strict';

/**
 * Main function to create the QTI 1.2 export package.
 *
 * @param {Array<Object>} questionsData - Array of combined question & answer objects.
 * @param {Array<Object>} allImages - Array of all unique image metadata objects.
 * @param {GoogleAppsScript.Drive.Folder} projectFolder - The Drive folder to save export files into.
 * @param {string} quizTitle - The title for the quiz/assessment.
 * @return {Object} Result object: { success: boolean, fileUrl?: string, message?: string }
 */
function QTIExport_createQTIPackage(questionsData, allImages, projectFolder, quizTitle) {
  console.log(`Starting QTI 1.2 package creation for "${quizTitle}"`);

  try {
    // 1. Create Subfolders
    const itemsFolder = projectFolder.createFolder('items');
    const resourcesFolder = projectFolder.createFolder(QTI_RESOURCES_PATH); // Use constant path name
    console.log('Created subfolders: items, resources');

    // 2. Process and Copy Images
    const imageFilenameMap = QTI_processAndCopyImages(allImages, resourcesFolder); // Returns Map<id, filename>
    console.log(`Processed and copied ${imageFilenameMap.size} images to resources folder.`);

    // 3. Generate Item XML Files
    const itemIdentifiers = []; // Store identifiers for manifest/assessment references
    questionsData.forEach((q, index) => {
      const itemNumber = q.number || (index + 1); // Use question number or fallback to index
      const itemIdentifier = `item_${itemNumber}`; // Consistent identifier
      itemIdentifiers.push(itemIdentifier);

      // Generate XML for the specific question type
      const itemXml = QTI_createItemXML(q, itemIdentifier, imageFilenameMap);
      if (itemXml) {
        itemsFolder.createFile(`${itemIdentifier}.xml`, itemXml, XML_MIME);
      } else {
        console.warn(`Skipping item XML generation for question number ${itemNumber} due to generation error or unsupported type.`);
        // Optionally remove identifier if skipped? Depends on strictness.
        itemIdentifiers.pop(); // Remove if skipped
      }
    });
    console.log(`Generated ${itemIdentifiers.length} item XML files.`);

    // 4. Generate Assessment XML (referencing items)
    const assessmentIdentifier = `assessment_${Utilities.getUuid().replace(/-/g, '')}`;
    const assessmentXml = QTI_createAssessmentXML(quizTitle, assessmentIdentifier, itemIdentifiers);
    const assessmentFile = projectFolder.createFile('assessment.xml', assessmentXml, XML_MIME);
    console.log('Generated assessment.xml');

    // 5. Generate Manifest XML (listing all resources)
    const manifestXml = QTI_createManifestXML(quizTitle, assessmentIdentifier, itemIdentifiers, imageFilenameMap);
    const manifestFile = projectFolder.createFile('imsmanifest.xml', manifestXml, XML_MIME);
    console.log('Generated imsmanifest.xml');

    // 6. Collect Files and Create Zip Package
    const blobs = [
      manifestFile.getBlob().setName('imsmanifest.xml'),
      assessmentFile.getBlob().setName('assessment.xml')
    ];

    // Add item files
    const itemFiles = itemsFolder.getFiles();
    while (itemFiles.hasNext()) {
      const file = itemFiles.next();
      blobs.push(file.getBlob().setName(`items/${file.getName()}`));
    }

    // Add resource files (images)
    const resourceFiles = resourcesFolder.getFiles();
    while (resourceFiles.hasNext()) {
      const file = resourceFiles.next();
      // Ensure filename matches the key used in the map/manifest
      const expectedFilename = file.getName();
      // Check if this filename should be included (based on imageFilenameMap values)
       let shouldInclude = false;
       for (const filename of imageFilenameMap.values()) {
            if (filename === expectedFilename) {
                shouldInclude = true;
                break;
            }
       }
       if (shouldInclude) {
            blobs.push(file.getBlob().setName(`${QTI_RESOURCES_PATH}${expectedFilename}`));
       } else {
            console.warn(`Skipping file in resources folder not found in image map: ${expectedFilename}`);
       }
    }
    console.log(`Collected ${blobs.length} blobs for zipping.`);

    // Create Zip
    const safeQuizTitle = quizTitle.replace(/[^a-zA-Z0-9_.\-]/g, '_'); // Sanitize for zip filename
    const zipFileName = `${safeQuizTitle}_QTI1.2.zip`;
    const zipBlob = Utilities.zip(blobs, zipFileName);
    const exportFile = projectFolder.createFile(zipBlob);
    console.log(`Created zip package: ${zipFileName}`);

    // 7. Store file info for download and return success
    PropertiesService.getScriptProperties().setProperties({
      lastExportFileId: exportFile.getId(),
      lastExportFileName: exportFile.getName()
    });

    return {
      success: true,
      fileUrl: exportFile.getUrl(),
      message: `Successfully created QTI 1.2 package: ${exportFile.getName()}`
    };

  } catch (e) {
    console.error(`QTI 1.2 Package creation failed: ${e}`, e.stack);
    return {
      success: false,
      message: `Error creating QTI 1.2 package: ${e.message}`
    };
  }
}

// ==========================================================================
// Helper Functions
// ==========================================================================

/**
 * Processes image metadata, copies image blobs to the resources folder,
 * and returns a map of image IDs to their final filenames.
 *
 * @param {Array<Object>} allImages - Array of image metadata objects from parsing.
 * @param {GoogleAppsScript.Drive.Folder} resourcesFolder - The folder to save images into.
 * @return {Map<string, string>} Map where keys are image IDs (e.g., 'uuid') and
 *                               values are the final filenames (e.g., 'q1_stem_uuid.png').
 */
function QTI_processAndCopyImages(allImages, resourcesFolder) {
  const imageFilenameMap = new Map();
  if (!allImages || allImages.length === 0) {
    return imageFilenameMap;
  }

  const seenFilenames = new Set();

  allImages.forEach(imgMeta => {
    if (!imgMeta || !imgMeta.id || !imgMeta.blob || !imgMeta.filename) {
      console.warn('Skipping invalid image metadata:', imgMeta);
      return;
    }

    // Ensure filename uniqueness (though generateImageFilename should mostly handle this)
    let finalFilename = imgMeta.filename;
    let counter = 1;
    while (seenFilenames.has(finalFilename)) {
        console.warn(`Duplicate filename detected: ${finalFilename}. Appending counter.`);
        const nameParts = finalFilename.split('.');
        const ext = nameParts.pop() || 'png'; // handle cases with no extension
        finalFilename = `${nameParts.join('.')}_${counter}.${ext}`;
        counter++;
    }

    try {
      // *** CORRECTION HERE: Set the blob's name before creating the file ***
      imgMeta.blob.setName(finalFilename);

      // Create the file in Drive
      resourcesFolder.createFile(imgMeta.blob); // No need to setName on the file again

      imageFilenameMap.set(imgMeta.id, finalFilename); // Map the original ID to the final filename
      seenFilenames.add(finalFilename);
    } catch (e) {
      console.error(`Failed to copy image blob to Drive (ID: ${imgMeta.id}, Filename: ${finalFilename}): ${e}`);
      // Optionally, decide if this failure should halt the process
    }
  });

  return imageFilenameMap;
}

/**
 * Creates the XML content for the main QTI 1.2 assessment file.
 * This file typically references the individual item XML files.
 *
 * @param {string} title - The title of the assessment.
 * @param {string} assessmentIdent - The unique identifier for the assessment.
 * @param {Array<string>} itemIdentifiers - Array of identifiers for the items included.
 * @return {string} The assessment XML content.
 */
function QTI_createAssessmentXML(title, assessmentIdent, itemIdentifiers) {
  const sanitizedTitle = sanitizeHtml(title);

  let itemRefsXML = '';
  itemIdentifiers.forEach(ident => {
    // QTI 1.2 uses <assessmentItemRef> inside <section>
    itemRefsXML += `      <assessmentItemRef href="items/${ident}.xml" identifier="${ident}"/>\n`;
  });

  // Basic QTI 1.2 assessment structure
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="${assessmentIdent}" title="${sanitizedTitle}">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>qmd_assessmenttype</fieldlabel>
        <fieldentry>Assessment</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
    <section ident="main_section" title="Main Section">
      <selection_ordering sequence_type="Normal"/>
${itemRefsXML}
    </section>
  </assessment>
</questestinterop>`;

  return xml;
}

/**
 * Creates the XML content for the imsmanifest.xml file.
 * Lists the assessment, item, and image resources.
 * Uses simplified QTI resource types.
 *
 * @param {string} title - The title of the package/quiz.
 * @param {string} assessmentIdent - Identifier of the assessment resource.
 * @param {Array<string>} itemIdentifiers - Array of item identifiers.
 * @param {Map<string, string>} imageFilenameMap - Map of image IDs to filenames.
 * @return {string} The imsmanifest.xml content.
 */
function QTI_createManifestXML(title, assessmentIdent, itemIdentifiers, imageFilenameMap) {
  const manifestIdent = `manifest_${Utilities.getUuid().replace(/-/g, '')}`;
  const orgIdent = `org_${Utilities.getUuid().replace(/-/g, '')}`;
  const assessmentResourceIdent = `resource_${assessmentIdent}`;
  const sanitizedTitle = sanitizeHtml(title);

  let itemResourcesXML = '';
  let itemDependenciesXML = '';
  itemIdentifiers.forEach(itemIdent => {
    const itemResourceIdent = `resource_${itemIdent}`;
    // *** Use simplified type: imsqti_xmlv1p2 ***
    itemResourcesXML += `    <resource identifier="${itemResourceIdent}" type="imsqti_xmlv1p2" href="items/${itemIdent}.xml">\n`;
    itemResourcesXML += `      <file href="items/${itemIdent}.xml"/>\n`;
    itemResourcesXML += `    </resource>\n`;
    // Assessment resource depends on item resources
    itemDependenciesXML += `      <dependency identifierref="${itemResourceIdent}"/>\n`;
  });

  let imageResourcesXML = '';
  imageFilenameMap.forEach(filename => {
    // Use filename as identifier for image resources, ensure uniqueness if needed
    const imageResourceIdent = `resource_${filename.replace(/[^a-zA-Z0-9]/g, '_')}`;
    imageResourcesXML += `    <resource identifier="${imageResourceIdent}" type="webcontent" href="${QTI_RESOURCES_PATH}${filename}">\n`;
    imageResourcesXML += `      <file href="${QTI_RESOURCES_PATH}${filename}"/>\n`;
    imageResourcesXML += `    </resource>\n`;
    // Items might depend on images, but QTI 1.2 manifests often don't list deps for webcontent. Keep it simple.
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifestIdent}" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" xmlns:imsqti="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd http://www.imsglobal.org/xsd/imsmd_v1p2 http://www.imsglobal.org/xsd/imsmd_v1p2p2.xsd http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <metadata>
    <schema>IMS Content</schema>
    <schemaversion>1.1.3</schemaversion> <!-- Keeping this version for now -->
    <imsmd:lom>
      <imsmd:general>
        <imsmd:title>
          <imsmd:langstring xml:lang="en">${sanitizedTitle}</imsmd:langstring>
        </imsmd:title>
      </imsmd:general>
    </imsmd:lom>
  </metadata>
  <organizations default="${orgIdent}">
    <organization identifier="${orgIdent}" structure="hierarchical">
      <title>${sanitizedTitle}</title>
      <item identifier="root_item" identifierref="${assessmentResourceIdent}">
        <title>${sanitizedTitle}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <!-- *** Use simplified type: imsqti_xmlv1p2 *** -->
    <resource identifier="${assessmentResourceIdent}" type="imsqti_xmlv1p2" href="assessment.xml">
      <file href="assessment.xml"/>
${itemDependenciesXML}
    </resource>
${itemResourcesXML}
${imageResourcesXML}
  </resources>
</manifest>`;
  return xml;
}


// ==========================================================================
// Item XML Generation Dispatcher and Specific Type Handlers
// ==========================================================================

/**
 * Creates the QTI 1.2 XML for a single assessment item based on its type.
 *
 * @param {Object} question - The combined question/answer object.
 * @param {string} itemIdent - The unique identifier for this item.
 * @param {Map<string, string>} imageFilenameMap - Map of image IDs to filenames.
 * @return {string|null} The generated item XML string, or null on failure.
 */
function QTI_createItemXML(question, itemIdent, imageFilenameMap) {
  console.log(`Generating QTI 1.2 XML for Item: ${itemIdent}, Type: ${question.type}`);

  let itemXml = null;
  try {
    switch (question.type) {
      case QUESTION_TYPES.MULTIPLE_CHOICE_SINGLE:
      case QUESTION_TYPES.TRUE_FALSE: // Handled similarly to MC Single
        itemXml = QTI_createMultipleChoiceSingleItem(question, itemIdent, imageFilenameMap);
        break;
      // case QUESTION_TYPES.MULTIPLE_CHOICE_MULTI:
      //   itemXml = QTI_createMultipleChoiceMultiItem(question, itemIdent, imageFilenameMap);
      //   break; // QTI 1.2 multi-response is tricky, implement later if needed
      case QUESTION_TYPES.FILL_IN_BLANK_TEXT:
      case QUESTION_TYPES.SHORT_ANSWER: // Often treated like FIB Text for basic auto-grading
        itemXml = QTI_createFillInBlankTextItem(question, itemIdent, imageFilenameMap);
        break;
      case QUESTION_TYPES.FILL_IN_BLANK_NUMERIC:
          itemXml = QTI_createFillInBlankNumericItem(question, itemIdent, imageFilenameMap);
          break;
      case QUESTION_TYPES.ESSAY:
        itemXml = QTI_createEssayItem(question, itemIdent, imageFilenameMap);
        break;
      case QUESTION_TYPES.MATCHING:
         itemXml = QTI_createMatchingItem(question, itemIdent, imageFilenameMap);
         break;
      case QUESTION_TYPES.ORDERING:
         itemXml = QTI_createOrderingItem(question, itemIdent, imageFilenameMap);
         break;
      // Add cases for other supported types
      default:
        console.warn(`Unsupported question type for QTI 1.2 generation: ${question.type} for item ${itemIdent}`);
        return null;
    }
  } catch (e) {
      console.error(`Error generating XML for item ${itemIdent} (Type: ${question.type}): ${e}`, e.stack);
      return null; // Return null if an error occurs during generation for a specific item
  }

  return itemXml;
}

// --- Specific Item Type Generators ---

/**
 * Generates QTI 1.2 XML for Multiple Choice (Single Response) and True/False items.
 */
function QTI_createMultipleChoiceSingleItem(q, itemIdent, imageFilenameMap) {
  const questionNumber = q.number || itemIdent.split('_')[1]; // Get number for context
  const responseIdent = `response_${itemIdent}`;
  const scoreIdent = `score_${itemIdent}`;

  // Prepare question stem (replace image placeholders)
  // Pass the correct image array (q.images) associated with the question object
  let stemText = replaceImagePlaceholdersWithHtml(q.text || `Question ${questionNumber}`, q.images);
  const stemHtml = `<![CDATA[${stemText}]]>`; // Wrap in CDATA

  // Prepare options
  let choicesXml = '';
  let correctChoiceIdentifier = null;
  if (!q.options || q.options.length === 0) {
      console.warn(`No options found for MC/TF question ${questionNumber}. Generating placeholder options.`);
      // Add placeholder options if missing
      q.options = [{letter: 'A', text: 'Option A'}, {letter: 'B', 'text': 'Option B'}];
      if (q.type === QUESTION_TYPES.TRUE_FALSE) q.options = [{letter: 'T', text: 'True'}, {letter: 'F', text: 'False'}];
      // Set a default correct answer if none provided? Risky.
      if (q.correctAnswer === null && q.options.length > 0) q.correctAnswer = q.options[0].letter;
  }


  q.options.forEach((opt, index) => {
    const choiceIdent = `choice_${opt.letter || index + 1}`; // Use letter or index
    // Pass the correct image array (opt.images) associated with this specific option
    let optionText = replaceImagePlaceholdersWithHtml(opt.text || `Option ${opt.letter}`, opt.images);
    const optionHtml = `<![CDATA[${optionText}]]>`;

    choicesXml += `        <response_label ident="${choiceIdent}" rshuffle="No">\n`; // Assuming no shuffle for simplicity
    choicesXml += `          <material><mattext texttype="text/html">${optionHtml}</mattext></material>\n`;
    choicesXml += `        </response_label>\n`;

    // Check if this option is the correct one
    if (q.correctAnswer && opt.letter && q.correctAnswer === opt.letter) {
      correctChoiceIdentifier = choiceIdent;
    }
  });

  if (!correctChoiceIdentifier && q.correctAnswer && q.options.length > 0) {
     // If correctAnswer letter was given but didn't match any option letter
     console.warn(`Correct answer letter "${q.correctAnswer}" for question ${questionNumber} did not match any option letter. Defaulting to first option.`);
     correctChoiceIdentifier = `choice_${q.options[0].letter || 1}`;
  } else if (!correctChoiceIdentifier && q.options.length > 0) {
     // No correct answer provided at all, default to first
     console.warn(`No correct answer specified for question ${questionNumber}. Defaulting to first option.`);
     correctChoiceIdentifier = `choice_${q.options[0].letter || 1}`;
  }


  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<item ident="${itemIdent}" title="Question ${questionNumber}">
  <itemmetadata>
    <qtimetadata>
      <qtimetadatafield><fieldlabel>qmd_itemtype</fieldlabel><fieldentry>Multiple Choice</fieldentry></qtimetadatafield>
    </qtimetadata>
  </itemmetadata>
  <presentation>
    <material>
      <mattext texttype="text/html">${stemHtml}</mattext>
    </material>
    <response_lid ident="${responseIdent}" rcardinality="Single">
      <render_choice shuffle="No">
${choicesXml}
      </render_choice>
    </response_lid>
  </presentation>
  <resprocessing>
    <outcomes>
      <decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100" defaultval="0"/>
    </outcomes>
    ${correctChoiceIdentifier ? `
    <respcondition continue="No">
      <conditionvar>
        <varequal respident="${responseIdent}">${correctChoiceIdentifier}</varequal>
      </conditionvar>
      <setvar varname="SCORE" action="Set">100</setvar> <!-- Assuming 100 points for correct -->
    </respcondition>
    <!-- Optional: condition for incorrect response setting score to 0 -->
    <respcondition continue="No">
        <conditionvar>
           <not><varequal respident="${responseIdent}">${correctChoiceIdentifier}</varequal></not>
        </conditionvar>
        <setvar varname="SCORE" action="Set">0</setvar>
    </respcondition>
    ` : `
    <!-- No correct answer identified, setting score to 0 -->
    <respcondition continue="No">
        <conditionvar><other/></conditionvar>
        <setvar varname="SCORE" action="Set">0</setvar>
    </respcondition>
    `}
  </resprocessing>
</item>`;
  return xml;
}

/**
 * Generates QTI 1.2 XML for Fill-in-the-Blank (Text) and Short Answer items.
 * Allows multiple possible correct answers (case-sensitive by default in QTI 1.2).
 */
function QTI_createFillInBlankTextItem(q, itemIdent, imageFilenameMap) {
  const questionNumber = q.number || itemIdent.split('_')[1];
  const responseIdent = `response_${itemIdent}`;

  let stemText = replaceImagePlaceholdersWithHtml(q.text || `Question ${questionNumber}`, q.images);
  // Add a visual blank indicator if not already present
  if (!stemText.includes('_____') && !stemText.includes('[blank]')) {
      stemText += ' _____';
  }
  const stemHtml = `<![CDATA[${stemText}]]>`;

  let correctAnswersXml = '';
  let hasCorrectAnswers = false;
  if (q.correctAnswer && Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0) {
      q.correctAnswer.forEach(ans => {
          if (ans && typeof ans === 'string' && ans.trim().length > 0) { // Ensure answer is valid
            correctAnswersXml += `          <varequal respident="${responseIdent}" case="No">${sanitizeHtml(ans.trim())}</varequal>\n`; // case="No" for case-insensitive comparison
            hasCorrectAnswers = true;
          }
      });
  }

  if (!hasCorrectAnswers) {
      console.warn(`No valid correct answer(s) provided for FIB/SA question ${questionNumber}. Item may not be auto-gradable.`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<item ident="${itemIdent}" title="Question ${questionNumber}">
  <itemmetadata>
    <qtimetadata>
      <qtimetadatafield><fieldlabel>qmd_itemtype</fieldlabel><fieldentry>Fill in the Blank</fieldentry></qtimetadatafield>
    </qtimetadata>
  </itemmetadata>
  <presentation>
    <material>
      <mattext texttype="text/html">${stemHtml}</mattext>
    </material>
    <response_str ident="${responseIdent}" rcardinality="Single">
      <render_fib fibtype="String" prompt="Box"/> <!-- prompt="Box" or "Line" -->
    </response_str>
  </presentation>
  <resprocessing>
    <outcomes>
      <decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100" defaultval="0"/>
    </outcomes>
    ${hasCorrectAnswers ? `
    <respcondition continue="No">
      <conditionvar>
        <!-- OR logic is implicit for multiple conditions here -->
${correctAnswersXml}
      </conditionvar>
      <setvar varname="SCORE" action="Set">100</setvar>
    </respcondition>
     <!-- Condition for incorrect -->
     <respcondition continue="No">
        <conditionvar>
            <not>
                <!-- Repeat the correct conditions inside the 'not' -->
${correctAnswersXml}
            </not>
        </conditionvar>
        <setvar varname="SCORE" action="Set">0</setvar>
     </respcondition>
     ` : `
     <!-- No valid answers, grading requires manual intervention or default 0 -->
     <respcondition continue="No">
        <conditionvar><other/></conditionvar>
        <setvar varname="SCORE" action="Set">0</setvar>
     </respcondition>
     `}
  </resprocessing>
</item>`;
  return xml;
}


/**
 * Generates QTI 1.2 XML for Fill-in-the-Blank (Numeric) items.
 */
function QTI_createFillInBlankNumericItem(q, itemIdent, imageFilenameMap) {
  const questionNumber = q.number || itemIdent.split('_')[1];
  const responseIdent = `response_${itemIdent}`;

  let stemText = replaceImagePlaceholdersWithHtml(q.text || `Question ${questionNumber}`, q.images);
   if (!stemText.includes('_____') && !stemText.includes('[blank]')) {
       stemText += ' _____';
   }
  const stemHtml = `<![CDATA[${stemText}]]>`;

  let conditionXml = '';
  let hasCorrectAnswer = false;
  if (q.correctAnswer !== null && typeof q.correctAnswer === 'number' && !isNaN(q.correctAnswer)) {
     // Simple numeric equality
     conditionXml = `<varequal respident="${responseIdent}">${q.correctAnswer}</varequal>`;
     hasCorrectAnswer = true;
  } else {
     console.warn(`Invalid or missing numeric answer for question ${questionNumber}. Expected a number.`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<item ident="${itemIdent}" title="Question ${questionNumber}">
  <itemmetadata>
    <qtimetadata>
      <qtimetadatafield><fieldlabel>qmd_itemtype</fieldlabel><fieldentry>Fill in the Blank Numeric</fieldentry></qtimetadatafield>
    </qtimetadata>
  </itemmetadata>
  <presentation>
    <material>
      <mattext texttype="text/html">${stemHtml}</mattext>
    </material>
    <response_num ident="${responseIdent}" numtype="Decimal" rcardinality="Single">
      <render_fib fibtype="Integer" prompt="Box"/> <!-- Or Decimal -->
    </response_num>
  </presentation>
  <resprocessing>
    <outcomes>
      <decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100" defaultval="0"/>
    </outcomes>
    ${hasCorrectAnswer ? `
    <respcondition continue="No">
      <conditionvar>
        ${conditionXml}
      </conditionvar>
      <setvar varname="SCORE" action="Set">100</setvar>
    </respcondition>
    <!-- Condition for incorrect -->
     <respcondition continue="No">
        <conditionvar>
            <not>${conditionXml}</not> <!-- QTI 1.2 <not> wraps the condition -->
        </conditionvar>
        <setvar varname="SCORE" action="Set">0</setvar>
     </respcondition>
     ` : `
     <!-- No valid answers, grading requires manual intervention or default 0 -->
     <respcondition continue="No">
        <conditionvar><other/></conditionvar>
        <setvar varname="SCORE" action="Set">0</setvar>
     </respcondition>
     `}
  </resprocessing>
</item>`;
  return xml;
}


/**
 * Generates QTI 1.2 XML for Essay items (typically manually graded).
 */
function QTI_createEssayItem(q, itemIdent, imageFilenameMap) {
  const questionNumber = q.number || itemIdent.split('_')[1];
  const responseIdent = `response_${itemIdent}`;

  const stemText = replaceImagePlaceholdersWithHtml(q.text || `Question ${questionNumber}`, q.images);
  const stemHtml = `<![CDATA[${stemText}]]>`;

  // Essay questions usually don't have automatic response processing for correctness.
  // The SCORE might be set manually by the grader or defaulted.
  // We can set score to 100 if any response is given, or leave it at 0 default. Let's set to 100 on any response.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<item ident="${itemIdent}" title="Question ${questionNumber}">
  <itemmetadata>
    <qtimetadata>
      <qtimetadatafield><fieldlabel>qmd_itemtype</fieldlabel><fieldentry>Essay</fieldentry></qtimetadatafield>
    </qtimetadata>
  </itemmetadata>
  <presentation>
    <material>
      <mattext texttype="text/html">${stemHtml}</mattext>
    </material>
    <response_str ident="${responseIdent}" rcardinality="Single">
      <render_fib fibtype="String" rows="10" prompt="Box"/> <!-- Larger box for essay -->
    </response_str>
  </presentation>
  <resprocessing>
    <outcomes>
      <decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100" defaultval="0"/>
    </outcomes>
    <!-- Optional: Award full points if *any* response is provided -->
     <respcondition continue="Yes"> <!-- Use continue="Yes" if other conditions might apply -->
       <conditionvar>
         <other/> <!-- Represents any response other than no response -->
       </conditionvar>
       <setvar varname="SCORE" action="Set">100</setvar>
       <displayfeedback feedbacktype="Response" linkrefid="general_fb"/>
     </respcondition>
  </resprocessing>
  <!-- Optional general feedback -->
   <itemfeedback ident="general_fb" view="Candidate">
     <material><mattext>Your response has been submitted for grading.</mattext></material>
   </itemfeedback>
</item>`;
  return xml;
}


/**
 * Generates QTI 1.2 XML for Matching items. This is complex in QTI 1.2.
 * Assumes options are structured like [{ letter: 'A', text: 'Premise' }, ...]
 * and correctAnswer is like [{ premise: 'A', response: '1' }, ...]
 */
function QTI_createMatchingItem(q, itemIdent, imageFilenameMap) {
    const questionNumber = q.number || itemIdent.split('_')[1];
    const responseIdent = `response_${itemIdent}`;

    const stemText = replaceImagePlaceholdersWithHtml(q.text || `Question ${questionNumber}`, q.images);
    const stemHtml = `<![CDATA[${stemText}]]>`;

    let premisesXml = '';
    let responsesXml = '';
    const premiseIdents = new Map(); // Map premise letter/text -> ident
    const responseIdents = new Map(); // Map response letter/text -> ident

    // Need to separate premises (typically column A) from responses (column B)
    // This requires a clear format in the Google Doc or assumptions.
    // Let's assume q.options contains BOTH premises and responses, identifiable maybe by letter vs number?
    // Or assume q.options = premises, q.responses = responses (requires parser update).
    // *Simplification*: Assume q.options contains premises (A, B, C...)
    // *Assumption*: The response options (1, 2, 3...) must be manually defined or inferred.
    // This is difficult without clear input structure. Let's try a basic structure.
    // Assume options = premises, and correctAnswers define the response mapping.
    // We need to create render_choice options for *both* sides.

    if (!q.options || q.options.length === 0 || !q.correctAnswer || !Array.isArray(q.correctAnswer) || q.correctAnswer.length === 0) {
        console.warn(`Matching question ${questionNumber} lacks sufficient options or correct answer pairs. Cannot generate XML.`);
        return null;
    }

    // Generate premise choices
    q.options.forEach((premiseOpt, index) => {
        const premiseIdent = `premise_${premiseOpt.letter || index + 1}`;
        // Use premiseOpt.letter as the key if available, otherwise maybe text? Requires consistency.
        const premiseKey = premiseOpt.letter || premiseOpt.text;
        if (!premiseKey) { console.warn(`Missing key (letter or text) for premise option in Q${questionNumber}`); return;}
        premiseIdents.set(premiseKey, premiseIdent); // Map letter/text to ident

        let premiseOptionText = replaceImagePlaceholdersWithHtml(premiseOpt.text, premiseOpt.images);
        premisesXml += `        <response_label ident="${premiseIdent}" rshuffle="No">\n`;
        premisesXml += `          <material><mattext texttype="text/html"><![CDATA[${premiseOptionText}]]></mattext></material>\n`;
        premisesXml += `        </response_label>\n`;
    });

    // Generate response choices (these need to exist somehow - extract from correct answers?)
    const uniqueResponses = [...new Set(q.correctAnswer.map(pair => pair.response))];
    uniqueResponses.sort(); // Sort them consistently
    uniqueResponses.forEach((responseVal, index) => {
         // Response value itself is the key
         if (!responseVal) { console.warn(`Missing response value in correct answer pair for Q${questionNumber}`); return; }
         const responseIdent = `response_${responseVal.replace(/[^a-zA-Z0-9]/g, '_') || index + 1}`; // Use value or index, sanitize value
         responseIdents.set(responseVal, responseIdent); // Map value to ident

         // Response text typically needs to be provided separately in the doc, or just use the value?
         let responseOptionText = responseVal; // Assuming the value is the text for now
         responsesXml += `        <response_label ident="${responseIdent}" rshuffle="No">\n`;
         responsesXml += `          <material><mattext texttype="text/html"><![CDATA[${responseOptionText}]]></mattext></material>\n`;
         responsesXml += `        </response_label>\n`;
    });


    // Generate response processing conditions based on correct pairs
    let correctPairsString = q.correctAnswer
        .map(pair => {
            const pIdent = premiseIdents.get(pair.premise); // Lookup using premise letter/text key
            const rIdent = responseIdents.get(pair.response); // Lookup using response value key
            if (pIdent && rIdent) {
                return `${pIdent}.${rIdent}`; // QTI 1.2 often uses dot notation for pairs in varsubset
            }
            console.warn(`Could not map pair: Premise Key="${pair.premise}", Response Key="${pair.response}" in Q${questionNumber}`);
            return null;
        })
        .filter(pairStr => pairStr !== null)
        .join(' '); // Space separated pairs


    if (!correctPairsString) {
         console.warn(`Could not generate valid correct pairs string for matching question ${questionNumber}.`);
         return null;
    }

    // This structure assumes a specific matching interaction type. QTI 1.2 is flexible but complex.
    // Using response_lid with Multiple cardinality and complex resprocessing is common.
    // Let's try that structure.

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<item ident="${itemIdent}" title="Question ${questionNumber}">
  <itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>qmd_itemtype</fieldlabel><fieldentry>Matching</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
  <presentation>
    <material><mattext texttype="text/html">${stemHtml}</mattext></material>
    <!-- QTI 1.2 Matching often uses two response_lids, one for premise, one for response -->
    <!-- Or a single response_lid with complex rendering hints. Let's simplify. -->
    <!-- This simplified structure assumes a dropdown or similar UI mapping premises to responses -->
    <response_lid ident="${responseIdent}" rcardinality="Multiple" rtiming="No"> <!-- Multiple responses needed -->
      <render_choice shuffle="No">
        <!-- Need pairs of choices -->
        ${premisesXml}
        ${responsesXml} <!-- This structure might need adjustment based on target LMS -->
      </render_choice>
    </response_lid>
  </presentation>
  <resprocessing>
    <outcomes><decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100" defaultval="0"/></outcomes>
    <!-- Simplified scoring fallback using varsubset for exact match -->
    <respcondition title="Calculate Score" continue="No">
        <conditionvar>
            <varsubset respident="${responseIdent}">${correctPairsString}</varsubset>
        </conditionvar>
        <!-- This condition checks if the submitted response set is exactly the correct set -->
        <setvar varname="SCORE" action="Set">100</setvar>
    </respcondition>
    <respcondition title="Incorrect Response" continue="No">
        <conditionvar>
            <not><varsubset respident="${responseIdent}">${correctPairsString}</varsubset></not>
        </conditionvar>
        <setvar varname="SCORE" action="Set">0</setvar>
    </respcondition>

  </resprocessing>
</item>`;
  return xml; // Note: QTI 1.2 Matching XML is highly variable and system-dependent. This is a basic attempt.
}


/**
 * Generates QTI 1.2 XML for Ordering items. Also complex in QTI 1.2.
 * Assumes q.options contains the items to be ordered, and q.correctAnswer is an array of the item texts/letters in the correct order.
 */
function QTI_createOrderingItem(q, itemIdent, imageFilenameMap) {
  const questionNumber = q.number || itemIdent.split('_')[1];
  const responseIdent = `response_${itemIdent}`;

  const stemText = replaceImagePlaceholdersWithHtml(q.text || `Question ${questionNumber}`, q.images);
  const stemHtml = `<![CDATA[${stemText}]]>`;

  let choicesXml = '';
  const choiceIdents = new Map(); // Map item text/letter -> ident

  if (!q.options || q.options.length === 0 || !q.correctAnswer || !Array.isArray(q.correctAnswer) || q.correctAnswer.length === 0) {
      console.warn(`Ordering question ${questionNumber} lacks sufficient options or correct answer sequence. Cannot generate XML.`);
      return null;
  }

  // Generate choices from the options provided
  q.options.forEach((opt, index) => {
      const choiceIdent = `choice_${opt.letter || index + 1}`;
      // Use option's letter OR its text as the key for mapping
      const optionKey = opt.letter || opt.text;
      if (!optionKey) { console.warn(`Missing key (letter or text) for ordering option in Q${questionNumber}`); return;}
      choiceIdents.set(optionKey, choiceIdent); // Map option identifier (letter or text) to QTI ident

      let optionText = replaceImagePlaceholdersWithHtml(opt.text, opt.images);
      choicesXml += `        <response_label ident="${choiceIdent}" rshuffle="Yes">\n`; // Usually shuffle ordering items
      choicesXml += `          <material><mattext texttype="text/html"><![CDATA[${optionText}]]></mattext></material>\n`;
      choicesXml += `        </response_label>\n`;
  });

  // Determine the correct sequence of identifiers
  const correctSequenceIdents = q.correctAnswer
      .map(itemIdentifier => choiceIdents.get(itemIdentifier)) // Map answer sequence items (should be letters or text from options) to QTI idents
      .filter(ident => ident); // Filter out any nulls if mapping failed

  if (correctSequenceIdents.length !== q.correctAnswer.length) {
       console.warn(`Could not map all items in the correct answer sequence for ordering question ${questionNumber}. Check if answer key items match option letters/text exactly.`);
       // Decide how to handle partial mapping - fail or proceed? Let's fail for now.
       return null;
  }
  const correctSequenceString = correctSequenceIdents.join(' '); // Space-separated string for varequal

   // QTI 1.2 Ordering uses response_lid (Ordered) and checks the sequence in resprocessing
   const xml = `<?xml version="1.0" encoding="UTF-8"?>
<item ident="${itemIdent}" title="Question ${questionNumber}">
  <itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>qmd_itemtype</fieldlabel><fieldentry>Ordering</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
  <presentation>
    <material><mattext texttype="text/html">${stemHtml}</mattext></material>
    <response_lid ident="${responseIdent}" rcardinality="Ordered"> <!-- Ordered cardinality is key -->
      <render_choice shuffle="Yes">
${choicesXml}
      </render_choice>
    </response_lid>
  </presentation>
  <resprocessing>
    <outcomes><decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100" defaultval="0"/></outcomes>
    <respcondition title="Correct Response" continue="No">
      <conditionvar>
        <varequal respident="${responseIdent}">${correctSequenceString}</varequal> <!-- Check if submitted sequence matches correct sequence -->
      </conditionvar>
      <setvar varname="SCORE" action="Set">100</setvar>
    </respcondition>
    <!-- Condition for incorrect -->
    <respcondition title="Incorrect Response" continue="No">
        <conditionvar>
            <not><varequal respident="${responseIdent}">${correctSequenceString}</varequal></not>
        </conditionvar>
        <setvar varname="SCORE" action="Set">0</setvar>
    </respcondition>
  </resprocessing>
</item>`;
  return xml;
}