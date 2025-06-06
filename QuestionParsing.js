/**
 * QuestionParsing.gs
 * Contains functions for parsing questions, options, and images from the Google Doc,
 * inferring question types suitable for QTI 1.2 export.
 */

// Dependency: Constants.gs (QUESTION_TYPES, questionTypes map)
// Dependency: Utilities.gs (generateImageFilename, sanitizeHtml - though sanitization happens at export)

/**
 * Extracts a common file extension from a MIME type string.
 * Handles common image types. Defaults to 'png'.
 * @param {string} mimeTypeString - e.g., "image/png", "image/jpeg"
 * @return {string} The file extension (e.g., "png", "jpg") or "png" as default.
 */
function getExtensionFromMimeType(mimeTypeString) {
    if (!mimeTypeString) return 'png';
    const lowerMime = mimeTypeString.toLowerCase();
    if (lowerMime.includes('png')) return 'png';
    if (lowerMime.includes('jpeg') || lowerMime.includes('jpg')) return 'jpg';
    if (lowerMime.includes('gif')) return 'gif';
    if (lowerMime.includes('bmp')) return 'bmp';
    // Add more types if needed
    // Fallback by splitting the string
    const parts = lowerMime.split('/');
    if (parts.length === 2 && parts[1]) {
        // Basic sanitization of potential extension part
        return parts[1].replace(/[^a-z0-9]/g, '').substring(0, 4) || 'png';
    }
    return 'png'; // Default fallback
}


/**
 * Processes a Google Docs element (Paragraph or ListItem) to extract text
 * and identify inline images, creating placeholders and metadata.
 *
 * @param {GoogleAppsScript.Document.Element} element - The Document element.
 * @return {{text: string, images: Array<Object>, isListItem: boolean, listId: string|null}}
 *         Object containing the extracted text with image placeholders ([IMG:id]),
 *         an array of image metadata objects ({id, blob, width, height, contentType}),
 *         a flag indicating if it's a list item, and its list ID.
 */
function processElement(element) {
  let fullText = '';
  const images = [];
  let isListItem = false;
  let listId = null;
  let elementType = element.getType();

  try {
    let paragraph; // Can be Paragraph or ListItem treated as Paragraph
    if (elementType === DocumentApp.ElementType.PARAGRAPH) {
      paragraph = element.asParagraph();
    } else if (elementType === DocumentApp.ElementType.LIST_ITEM) {
      paragraph = element.asListItem();
      isListItem = true;
      listId = paragraph.getListId(); // Get list ID for potential Ordering/Matching detection
    } else {
      // Skip unsupported element types
      return { text: '', images: [], isListItem: false, listId: null };
    }

    const numChildren = paragraph.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = paragraph.getChild(i);
      const type = child.getType();

      if (type === DocumentApp.ElementType.TEXT) {
        fullText += child.asText().getText();
      } else if (type === DocumentApp.ElementType.INLINE_IMAGE) {
        const image = child.asInlineImage();
        const imageId = Utilities.getUuid().replace(/-/g, ''); // Unique ID for this image instance
        try {
          const blob = image.getBlob(); // Get the image data
          const contentType = blob.getContentType();
          // Store essential metadata; filename generated later using context
          images.push({
            id: imageId,
            blob: blob,
            contentType: contentType, // Store the content type
            originalName: blob.getName() || `image_${imageId}`, // Use blob name or generate one
            width: image.getWidth(),
            height: image.getHeight()
          });
          // Insert placeholder into the text stream
          fullText += `[IMG:${imageId}]`;
        } catch (e) {
            console.error(`Could not process InlineImage (ID: ${imageId}): ${e}. Skipping image.`);
            // Optionally insert an error placeholder: fullText += `[ERR: Image processing failed ${imageId}]`;
        }
      }
      // Add other type handlers if needed (e.g., HorizontalRule, Footnote)
    }
  } catch (e) {
    console.error(`Error processing element: ${e}`);
    // Return potentially partial data
    return { text: fullText.trim(), images: images, isListItem: isListItem, listId: listId };
  }

  return { text: fullText.trim(), images: images, isListItem: isListItem, listId: listId };
}

/**
 * Infers the question type based on keywords, structure, or defaults.
 * This is a crucial step for guiding parsing and export.
 *
 * @param {string} text - The initial text of the question.
 * @param {Array<Object>} initialOptions - Any options already parsed for this question (if any).
 * @param {boolean} isListItem - Whether the question line is part of a list.
 * @param {string|null} listId - The list ID if it's a list item.
 * @return {string} The inferred question type constant from QUESTION_TYPES.
 */
function inferQuestionType(text, initialOptions = [], isListItem = false, listId = null) {
    const upperText = text.toUpperCase();

    // Specific keyword checks first
    if (/\bTRUE\b.*\bFALSE\b/.test(upperText) || /TRUE\/FALSE/.test(upperText)) {
        return QUESTION_TYPES.TRUE_FALSE;
    }
    if (/\bMATCHING\b/.test(upperText) || /^\s*MATCH\s/i.test(text)) {
        return QUESTION_TYPES.MATCHING;
    }
     if (/\bORDERING\b/.test(upperText) || /\bORDER\b/.test(upperText) || /\bSEQUENCE\b/.test(upperText)) {
         return QUESTION_TYPES.ORDERING;
     }
    if (text.includes('___')) { // Simple check for fill-in-the-blanks
        // Could add logic here to check if blanks suggest numbers vs text
        return QUESTION_TYPES.FILL_IN_BLANK_TEXT;
    }

    // Structural checks
    if (initialOptions && initialOptions.length > 0) {
        // Check if options look like True/False
        const optionLetters = initialOptions.map(opt => opt.letter);
        if (optionLetters.includes('T') && optionLetters.includes('F')) {
             return QUESTION_TYPES.TRUE_FALSE;
        }
        // Default MC if options exist and aren't T/F
        return QUESTION_TYPES.MULTIPLE_CHOICE_SINGLE;
    }

    // Contextual checks (less reliable)
    // if (isListItem && listId) {
    // Could potentially infer Ordering/Matching if subsequent items follow a pattern,
    // but this is complex and prone to errors. Better rely on keywords or explicit answers.
    // }

    // Default types
    // If it's very short, maybe short answer? If longer, essay? This is subjective.
    // Let's default to ESSAY as a safe bet for manually graded items if nothing else fits.
    // Or SHORT_ANSWER if a more specific type isn't clear.
    // Consider SHORT_ANSWER as a reasonable default that can sometimes be auto-graded.
    return QUESTION_TYPES.SHORT_ANSWER;
}


/**
 * Parses the Google Document body to extract questions, answers, and images.
 *
 * @return {{questions: Array<Object>, images: Array<Object>}}
 *         Object containing an array of parsed question objects and an array
 *         of all unique image metadata objects found.
 */
function parseQuestions() {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const questions = [];
  const allImages = []; // Store all unique image metadata here
  let currentQuestion = null;
  let currentOptions = []; // Holds options for the current question being built
  let accumulatedImages = []; // Images collected for the current question (stem + options)
  let reachedAnswerKey = false;
  let currentQuestionNumber = 0;

  console.log('Starting QTI 1.2 question parsing...');
  questionTypes.clear(); // Reset global question type map

  const numChildren = body.getNumChildren();
  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    const elementData = processElement(child);
    let { text: elementText, images: elementImages, isListItem, listId } = elementData;

    if (!elementText && elementImages.length === 0) {
      // Skip empty elements entirely
      continue;
    }

    // 1. Check for Answer Key Header (simple check)
    if (/^\s*ANSWER\s+KEY\s*:?\s*$/i.test(elementText)) {
      console.log(`Found answer key header at element index ${i}. Stopping question parsing.`);
      reachedAnswerKey = true;
      break; // Stop processing further elements
    }

    // Add newly found images to accumulated list for the potential current question
    // Generate filenames now using context (we'll refine context later if needed)
    elementImages.forEach(imgMeta => {
      const contextHint = currentQuestion ? `q${currentQuestion.number}` : 'doc';
      // *** CORRECTION HERE ***
      const fileExtension = getExtensionFromMimeType(imgMeta.contentType); // Use helper function
      imgMeta.filename = generateImageFilename(
          currentQuestion ? currentQuestion.number : 0,
          `elem${i}_img${imgMeta.id.substring(0,4)}`, // Add image ID hint for uniqueness
          imgMeta.id,
          fileExtension // Pass the determined extension
      );
      accumulatedImages.push(imgMeta);
      allImages.push(imgMeta); // Add to global list as well
       console.log(`Processed image: ${imgMeta.filename} (ID: ${imgMeta.id}, Type: ${imgMeta.contentType})`);
    });


    // 2. Detect Start of a New Question (e.g., "1.", "1)", "1 -")
    // More robust regex: Optional space, digits, required space/dot/paren/dash, required space
    const questionStartMatch = elementText.match(/^\s*(\d+)\s*[.)-]\s+(.*)/);

    if (questionStartMatch) {
      const detectedNumber = parseInt(questionStartMatch[1], 10);
      const questionTextStart = questionStartMatch[2].trim(); // Text after the number

      console.log(`Detected potential question start: Number ${detectedNumber}`);

      // Finalize the previous question before starting a new one
      if (currentQuestion) {
        // Ensure accumulated images are linked to the question before finalizing
        currentQuestion.images = accumulatedImages.filter(img =>
             (currentQuestion.text && currentQuestion.text.includes(`[IMG:${img.id}]`)) ||
             (currentQuestion.options && currentQuestion.options.some(opt => opt.text && opt.text.includes(`[IMG:${img.id}]`)))
        );
        currentQuestion.hasImages = currentQuestion.images.length > 0;

        // Add the completed question to the list
        questions.push(currentQuestion);
        console.log(`Finalized question ${currentQuestion.number}: Type=${currentQuestion.type}, Options=${currentQuestion.options.length}, Images=${currentQuestion.images.length}`);
      }

      // --- Start the new question ---
      currentQuestionNumber = detectedNumber;
      currentOptions = []; // Reset options for the new question
      // Filter accumulated images to only keep those from the CURRENT element starting the question
      accumulatedImages = accumulatedImages.filter(img => elementText.includes(`[IMG:${img.id}]`));


      // Infer the type for this new question
      const inferredType = inferQuestionType(questionTextStart, [], isListItem, listId);

      currentQuestion = {
        number: currentQuestionNumber,
        type: inferredType,
        text: questionTextStart, // Start with text after number
        options: currentOptions, // Reference to the live options array
        images: [], // Will be populated during finalization
        hasImages: accumulatedImages.length > 0, // Based on images in *this* starting element
        // Potentially add listId or other metadata if needed for parsing logic later
      };

      // Store the inferred type in the global map for answer key parsing
      questionTypes.set(currentQuestionNumber, inferredType);
      console.log(`Started new question ${currentQuestionNumber}: Inferred Type=${inferredType}`);

    } else if (currentQuestion) {
      // 3. Process as Continuation or Option of the Current Question

       // Add any images found on this continuation/option line to the accumulated list
      // Note: This was already done near the top of the loop, so accumulatedImages is up-to-date.

      let isOption = false;

      // More robust option detection (handles A., A), (A), a., a), (a) etc.) with text following
      const optionMatch = elementText.match(/^\s*(?:(?:([A-Za-z])\s*[.)])|(?:\(\s*([A-Za-z])\s*\)))\s+(.*)/);

      if (optionMatch) {
        isOption = true;
        const letter = (optionMatch[1] || optionMatch[2]).toUpperCase();
        const optionText = optionMatch[3].trim(); // Text after the letter/marker

        console.log(`Detected option ${letter} for question ${currentQuestionNumber}`);

        // Find images specifically belonging to this option line's text
        const optionImages = accumulatedImages.filter(img => optionText.includes(`[IMG:${img.id}]`));


        const newOption = {
          letter: letter,
          text: optionText, // Contains [IMG:id] placeholders if images were present
          images: optionImages // Metadata for images referenced *in this specific option text*
          // hasImages is implicitly true if optionImages.length > 0
        };
        currentOptions.push(newOption);

        // Refine question type if options suggest MC or T/F
        if (currentQuestion.type !== QUESTION_TYPES.MULTIPLE_CHOICE_SINGLE &&
            currentQuestion.type !== QUESTION_TYPES.MULTIPLE_CHOICE_MULTI &&
            currentQuestion.type !== QUESTION_TYPES.TRUE_FALSE &&
            currentQuestion.type !== QUESTION_TYPES.MATCHING && // Avoid overriding MATCHING
            currentQuestion.type !== QUESTION_TYPES.ORDERING) { // Avoid overriding ORDERING
           // Basic check for T/F options
           const currentLetters = currentOptions.map(o => o.letter);
           if (currentLetters.includes('T') && currentLetters.includes('F')) {
                currentQuestion.type = QUESTION_TYPES.TRUE_FALSE;
                questionTypes.set(currentQuestionNumber, QUESTION_TYPES.TRUE_FALSE);
                console.log(`Re-inferred question ${currentQuestionNumber} as TRUE_FALSE based on options`);
           } else {
               // Default to MC Single if standard options appear
                currentQuestion.type = QUESTION_TYPES.MULTIPLE_CHOICE_SINGLE;
                questionTypes.set(currentQuestionNumber, QUESTION_TYPES.MULTIPLE_CHOICE_SINGLE);
                console.log(`Re-inferred question ${currentQuestionNumber} as MULTIPLE_CHOICE_SINGLE based on options`);
           }
        }
      }

      // Handle Matching/Ordering items (example - needs refinement based on expected format)
      // Example: Match Item "A. Term" paired with "1. Definition" elsewhere, or "1. Step one" for ordering
      // This requires more complex state management or clearer document formatting conventions.
      // Basic placeholder for potential future implementation:
      /*
      if (currentQuestion.type === QUESTION_TYPES.MATCHING) {
         // Look for patterns like "A. Premise Text" or "1. Response Text"
         // Store pairs appropriately in currentOptions
      } else if (currentQuestion.type === QUESTION_TYPES.ORDERING) {
         // Look for numbered or lettered list items that aren't standard MC options
         // Store items in sequence in currentOptions
      }
      */

      // If it wasn't an option start or other special item, append text to the current question stem
      if (!isOption && elementText) { // Check elementText is not empty
          // Add a space only if the current text doesn't already end with one
          // and the new text doesn't start with punctuation that shouldn't have a preceding space.
          const needsSpace = currentQuestion.text && !/\s$/.test(currentQuestion.text) && !/^[.,;:!?]/.test(elementText);
          currentQuestion.text += (needsSpace ? ' ' : '') + elementText;
          console.log(`Appended text to question ${currentQuestionNumber}`);
      }

      // Track that images found on this line are associated with the current question overall
      if (elementImages.length > 0) {
          currentQuestion.hasImages = true;
      }


    } else {
      // Content before the first numbered question - handle as needed
      // Could be instructions, a title, or an unnumbered first question.
      // For now, we'll mostly ignore it unless specifically handled.
      console.log(`Skipping content before first numbered question (Index ${i}): "${elementText.substring(0, 50)}..."`);
    }

    // Break loop if answer key was detected in this iteration
    if (reachedAnswerKey) {
      break;
    }
  } // End loop through document elements

  // Finalize the very last question after the loop finishes (if one exists)
  if (currentQuestion) {
     // Ensure accumulated images are linked before finalizing
     // Need to check text/options for placeholders associated with *any* image in accumulatedImages
     currentQuestion.images = accumulatedImages.filter(img =>
           (currentQuestion.text && currentQuestion.text.includes(`[IMG:${img.id}]`)) ||
           (currentQuestion.options && currentQuestion.options.some(opt => opt.text && opt.text.includes(`[IMG:${img.id}]`)))
     );
     currentQuestion.hasImages = currentQuestion.images.length > 0;


      questions.push(currentQuestion);
      console.log(`Finalized last question ${currentQuestion.number}: Type=${currentQuestion.type}, Options=${currentQuestion.options.length}, Images=${currentQuestion.images.length}`);
  }

  console.log(`Total questions parsed: ${questions.length}`);
  console.log(`Total unique images found: ${allImages.length}`); // Note: allImages might contain duplicates if handled improperly, review logic if needed.

  if (questions.length === 0) {
      console.warn("No numbered questions were found in the document.");
      // Consider throwing an error or returning an empty structure based on desired behavior
      // throw new AppError("No questions found", "Could not find any numbered questions in the document. Please ensure questions start with a number followed by a period or parenthesis (e.g., '1. Question Text').");
  }

  // Return the parsed questions and the master list of image metadata
  return { questions: questions, images: allImages };
}