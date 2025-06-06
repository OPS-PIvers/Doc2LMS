/**
 *  🔧  Utilities.gs
 *  ——————————————————————————————————————————————————————————
 *  Canonical helper functions shared by parsing and export modules.
 *  Updated for QTI 1.2 focus.
 */

/** Constant relative path for images within the QTI package */
const QTI_RESOURCES_PATH = 'resources/'; // Standard relative path

/**
 * Sanitizes text for safe inclusion in XML attributes or elements.
 * Replaces XML special characters with their corresponding entities.
 * @param {string} text - The input string.
 * @return {string} The sanitized string.
 */
function sanitizeHtml(text) {
  if (text === null || typeof text === 'undefined') return '';
  return String(text) // Ensure input is a string
    .replace(/&/g,  '&')
    .replace(/</g,  '<')
    .replace(/>/g,  '>')
    .replace(/"/g,  '"')
}

/**
 * Replaces image placeholders like [IMG:uuid] in text with HTML <img> tags
 * suitable for QTI 1.2 <mattext texttype="text/html"> elements wrapped in CDATA.
 *
 * @param {string} text - The text containing image placeholders (e.g., "See figure [IMG:xyz]").
 * @param {Array<Object>} questionImages - An array of image metadata objects associated
 *                                         with the current question/option being processed.
 *                                         Each object should have at least {id, filename, width, height}.
 * @return {string} The text with placeholders replaced by HTML <img> tags.
 */
function replaceImagePlaceholdersWithHtml(text, questionImages) {
  if (!text || !questionImages || questionImages.length === 0) {
    return text; // Return original text if no replacements needed or possible
  }

  let processedText = text;
  const placeholderRegex = /\[IMG:([^\]]+)\]/g;
  let match;

  // Create a map for quick lookup of images by their ID
  const imageMetaMap = new Map();
  questionImages.forEach(img => {
    if (img && img.id) {
      imageMetaMap.set(img.id, img);
    }
  });

  // Iterate through placeholders and replace them
  while ((match = placeholderRegex.exec(text)) !== null) {
    const placeholder = match[0]; // The full placeholder e.g., "[IMG:xyz]"
    const imageId = match[1];     // The image ID e.g., "xyz"

    const imageMeta = imageMetaMap.get(imageId);

    if (imageMeta && imageMeta.filename) {
      // Construct the relative path using the defined constant
      const imagePath = QTI_RESOURCES_PATH + imageMeta.filename;
      // Sanitize alt text (currently empty) and path for attributes
      const sanitizedPath = sanitizeHtml(imagePath);
      const altText = ""; // Alt text often not well-supported or needed in simple QTI conversion

      // Generate the HTML img tag. Include width/height if available.
      let imgTag = `<img src="${sanitizedPath}" alt="${altText}"`;
      if (imageMeta.width && imageMeta.height) {
        imgTag += ` width="${imageMeta.width}" height="${imageMeta.height}"`;
      }
      imgTag += ` />`;

      // Replace the specific placeholder instance in the processed text
      // Use replace instead of global replace inside loop to handle multiple identical placeholders correctly
      processedText = processedText.replace(placeholder, imgTag);

    } else {
      // If image metadata is not found for the ID, log a warning and leave the placeholder
      console.warn(`Image metadata not found for placeholder ID: ${imageId}. Placeholder "${placeholder}" left in text.`);
    }
  }

  return processedText;
}

/**
 * Generates a unique filename for an image based on question number,
 * context (stem/option), and a unique ID. Ensures basic sanitization.
 *
 * @param {number} questionNumber - The number of the question.
 * @param {string} context - 'stem', 'optionA', 'optionB', 'match1', etc.
 * @param {string} imageId - A unique identifier for the image (e.g., UUID).
 * @param {string} originalExtension - The original file extension (e.g., 'png', 'jpg'). Defaults to 'png'.
 * @return {string} A sanitized, unique filename.
 */
function generateImageFilename(questionNumber, context, imageId, originalExtension = 'png') {
    const baseName = `q${questionNumber}_${context}_${imageId}`;
    const extension = (originalExtension || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Basic sanitization: replace non-alphanumeric with underscores
    const sanitizedBase = baseName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
    return `${sanitizedBase}.${extension}`;
}

/**
 * Formats a Date object into a consistent timestamp string for folder names.
 * Example: Jan 15 2024 14:30
 * @param {Date} date - The date object to format.
 * @return {string} The formatted timestamp string.
 */
function formatTimestamp(date) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var day = date.getDate();
  var month = months[date.getMonth()];
  var year = date.getFullYear();
  var hours = String(date.getHours()).padStart(2, '0');
  var minutes = String(date.getMinutes()).padStart(2, '0');
  return month + " " + day + " " + year + " " + hours + ":" + minutes;
}

/** Correct XML mime-type since MimeType.XML does not exist */
const XML_MIME = 'application/xml';