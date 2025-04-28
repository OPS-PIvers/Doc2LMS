/**
 * Code.gs – Main entry point and orchestrator for the QTI 1.2 conversion.
 */

// Dependencies:
// - QuestionParsing.gs (parseQuestions)
// - AnswerKeyParsing.gs (parseAnswerKey)
// - QTIExport.gs (QTIExport_createQTIPackage - to be created)
// - Utilities.gs (formatTimestamp)
// - AppError.gs
// - Sidebar.html

/**
 * Adds the custom menu to the Google Doc UI when the document is opened.
 */
function onOpen() {
  DocumentApp.getUi()
    .createMenu('Quiz Tools')
    .addItem('Open QTI Converter', 'showSidebar')
    // Removed 'Apply Quick Fixes' and 'Audit Question Types' for simplification
    .addToUi();
}

/**
 * Displays the main sidebar interface for the converter.
 */
function showSidebar() {
  try {
    // Assumes Sidebar.html exists and is updated to remove format selection
    const template = HtmlService.createTemplateFromFile('Sidebar');
    const evaluated = template.evaluate().setTitle('QTI 1.2 Converter').setWidth(300);
    DocumentApp.getUi().showSidebar(evaluated);
    console.log('Sidebar shown.');
    return 'Sidebar created'; // Return value primarily for testing/logging
  } catch (e) {
    console.error('Error showing sidebar: ' + e);
    // Show error to user?
    DocumentApp.getUi().alert(`Error loading sidebar: ${e.message}`);
    throw e; // Re-throw for execution log
  }
}

/**
 * Helper function required by HtmlService templates to include other HTML files.
 * @param {string} filename - The name of the HTML file to include (e.g., 'Stylesheet.html').
 * @return {string} The content of the included HTML file.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Combines parsed questions with their corresponding parsed answers from the Map.
 *
 * @param {Array<Object>} questions - Array of question objects from parseQuestions.
 *                                    Each object must have a unique `number` property.
 * @param {Map<number, Object>} answerMap - Map of answers from parseAnswerKey,
 *                                          where keys are question numbers and values
 *                                          are the structured answer data.
 * @return {Array<Object>} A new array where each question object is augmented
 *                         with a `correctAnswer` property containing the data
 *                         from the answerMap, or null if no answer was found.
 */
function combineQuestionsAndAnswers(questions, answerMap) {
  if (!Array.isArray(questions)) {
      throw new Error('combineQuestionsAndAnswers: Input `questions` must be an array.');
  }
  if (!(answerMap instanceof Map)) {
       throw new Error('combineQuestionsAndAnswers: Input `answerMap` must be a Map.');
  }

  console.log(`Combining ${questions.length} questions with ${answerMap.size} answers.`);

  return questions.map(q => {
    if (q === null || typeof q !== 'object' || typeof q.number === 'undefined') {
        console.warn('Skipping invalid question object in combineQuestionsAndAnswers:', q);
        return null; // Skip invalid question structures
    }

    const answerData = answerMap.get(q.number); // Get answer using question number

    if (typeof answerData === 'undefined') {
        console.warn(`No answer found in map for question number: ${q.number}`);
    }

    // Create a new object combining question and its answer
    // Using Object.assign to avoid modifying the original question object directly
    return Object.assign({}, q, {
      correctAnswer: typeof answerData !== 'undefined' ? answerData : null // Add answerData or null
    });
  }).filter(q => q !== null); // Filter out any skipped invalid questions
}


/**
 * Orchestrates the conversion process from Google Doc to QTI 1.2 format.
 * Called from the sidebar UI.
 *
 * @param {Object} options - (Optional) Placeholder for any future options. Currently unused.
 * @return {Object} Result object for the sidebar: { success: boolean, message: string, exportFolderUrl?: string, fileUrl?: string }
 */
function startConversion(options = {}) {
  try {
    console.log('Starting QTI 1.2 conversion process...');
    const doc = DocumentApp.getActiveDocument();
    const docName = doc.getName() || 'Untitled Document';

    // --- Folder Setup ---
    const mainFolder = getOrCreateMainFolder();
    const timestamp = formatTimestamp(new Date());
    // Sanitize docName slightly for folder name if needed
    const safeDocName = docName.replace(/[/\\?%*:|"<>]/g, '-'); // Basic sanitization
    const projectFolder = mainFolder.createFolder(`${safeDocName} - QTI 1.2 - ${timestamp}`);
    console.log(`Created project folder: ${projectFolder.getName()}`);

    // --- Parsing ---
    // 1. Parse Questions and Images
    const { questions: parsedQuestions, images: allImages } = parseQuestions();
    if (!parsedQuestions || parsedQuestions.length === 0) {
       throw new AppError("Parsing Error", "No questions could be parsed from the document.");
    }
    console.log(`Parsed ${parsedQuestions.length} questions and found ${allImages.length} image references.`);

    // 2. Parse Answer Key
    const answerMap = parseAnswerKey(); // Returns a Map { number: answerData }
    console.log(`Parsed answers for ${answerMap.size} questions.`);

    // 3. Combine Questions and Answers
    const combinedData = combineQuestionsAndAnswers(parsedQuestions, answerMap);
    if (combinedData.length !== parsedQuestions.length) {
        console.warn(`Number of combined items (${combinedData.length}) differs from initially parsed questions (${parsedQuestions.length}). Check for parsing errors or data loss.`);
    }
    console.log(`Combined data prepared for ${combinedData.length} questions.`);

    // --- Export ---
    // Call the specific QTI 1.2 export function (to be implemented in QTIExport.gs)
    // It needs the combined data, all image metadata, the output folder, and the quiz title.
    // Assuming the function is named QTIExport_createQTIPackage
    const exportResult = QTIExport_createQTIPackage(combinedData, allImages, projectFolder, docName);

    console.log('QTI 1.2 Export function completed.');

    // Check export result structure (assuming it returns { success, fileUrl, ... })
    if (!exportResult || !exportResult.success) {
        throw new Error(`QTI package creation failed. Reason: ${exportResult?.message || 'Unknown error from exporter.'}`);
    }

    // --- Success Response ---
    const successMessage = `Conversion to QTI 1.2 completed successfully for ${combinedData.length} questions.`;
    console.log(successMessage);
    return {
      success: true,
      exportFolderUrl: projectFolder.getUrl(),
      fileUrl: exportResult.fileUrl, // URL of the generated ZIP file
      message: successMessage
    };

  } catch (e) {
    console.error('Conversion failed:', e);
    const ui = DocumentApp.getUi();
    let userMessage;
    if (e instanceof AppError) { // Use custom error message if available
      userMessage = e.userMessage;
    } else {
      userMessage = `An unexpected error occurred: ${e.message}`;
    }
     // Also log stack trace if available
     if (e.stack) {
         console.error(`Stack Trace: ${e.stack}`);
     }

    // Display error in UI
    ui.alert('QTI Conversion Error', userMessage, ui.ButtonSet.OK);

    // Return error structure to sidebar
    return {
      success: false,
      message: `Error: ${userMessage}`
    };
    // Note: Re-throwing 'e' might be desirable for Apps Script's execution log,
    // but returning the structure allows the sidebar JS to handle the failure gracefully.
    // Consider if re-throwing is needed based on debugging/logging strategy.
    // throw e;
  }
}

/**
 * Retrieves or creates the main parent folder for all quiz exports.
 * @return {GoogleAppsScript.Drive.Folder} The Drive Folder object.
 */
function getOrCreateMainFolder() {
  const folderName = "Doc to LMS Exports"; // Changed name slightly for clarity
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    const folder = folders.next();
    console.log(`Using existing main export folder: "${folderName}"`);
    return folder;
  } else {
    const folder = DriveApp.createFolder(folderName);
    console.log(`Created new main export folder: "${folderName}"`);
    return folder;
  }
}

/**
 * Prepares the last exported QTI package for direct download via the sidebar.
 * Retrieves the file ID and name stored in Script Properties by the export function.
 *
 * @return {Object} Object containing base64 data, mime type, and filename for download.
 *                  Throws an error if preparation fails.
 */
function getDirectDownloadUrl() {
  try {
    console.log("Preparing file for download...");
    const scriptProperties = PropertiesService.getScriptProperties();
    const fileId = scriptProperties.getProperty("lastExportFileId");
    const fileName = scriptProperties.getProperty("lastExportFileName");

    if (!fileId) {
      throw new Error("No previous export file information found. Please run a conversion first.");
    }
    if (!fileName) {
        console.warn("Last export filename not found in properties, will use Drive file name.");
    }

    console.log(`Retrieving file ID: ${fileId}`);
    const file = DriveApp.getFileById(fileId);
    const effectiveFileName = fileName || file.getName(); // Use stored name or fallback to current name
    const blob = file.getBlob();
    const mimeType = blob.getContentType();
    const base64Data = Utilities.base64Encode(blob.getBytes());

    console.log(`File ready for download: ${effectiveFileName}, MimeType: ${mimeType}`);
    return {
        data: base64Data,
        mimeType: mimeType,
        filename: effectiveFileName
    };
  } catch (e) {
    console.error('Download preparation failed:', e);
    // Provide a more user-friendly error message
    let message = `Download preparation failed: ${e.message}`;
    if (e.message && e.message.includes("Access denied: DriveApp")) {
        message = "Download failed: The script may no longer have permission to access the file in Google Drive. Please try converting again.";
    } else if (e.message && e.message.includes("File not found")) {
        message = "Download failed: The exported file seems to have been deleted or moved. Please try converting again.";
    }
    // Throwing an error here will be caught by the .withFailureHandler in Sidebar.html JS
    throw new Error(message);
  }
}