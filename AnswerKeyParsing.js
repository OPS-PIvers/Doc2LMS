/**
 * AnswerKeyParsing.gs
 *
 * Contains functions related to parsing the answer key section of the document,
 * interpreting answers based on pre-determined question types for QTI 1.2 export.
 */

// Dependency: Constants.gs (QUESTION_TYPES, questionTypes map)
// Dependency: Utilities.gs (optional, for text cleaning if needed beyond basic trim)

/**
 * Checks if a given text line matches common patterns for an answer key header.
 * Case-insensitive and allows optional colons.
 *
 * @param {string} text - The text line to check.
 * @return {boolean} True if the text is considered an answer key header.
 */
function isAnswerKeyHeader(text) {
  if (!text) return false;
  const patterns = [
    /^\s*ANSWER\s+KEY\s*:?\s*$/i,
    /^\s*ANSWERS\s*:?\s*$/i,
    /^\s*KEY\s*:?\s*$/i
    // Add more specific patterns if needed, e.g., /^Section\s+Answers:?$/i
  ];
  return patterns.some(pattern => pattern.test(text.trim()));
}

/**
 * Cleans potential noise from an answer key line before parsing.
 * Example: Removes leading "Answer:", "Key:", etc.
 *
 * @param {string} text - The raw text from the answer key line.
 * @return {string} The cleaned text.
 */
function cleanAnswerKeyText(text) {
  if (!text) return '';
  return text
    .trim()
    // Remove common prefixes (case-insensitive)
    .replace(/^[aA]nswer\s*[:\-]?\s*/i, '')
    .replace(/^[kK]ey\s*[:\-]?\s*/i, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove zero-width spaces and similar characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/**
 * Parses a single line from the answer key section.
 * Determines how to interpret the answer based on the globally stored question type.
 *
 * @param {string} lineText - The text content of the line to parse.
 * @return {Object|null} An object like { number: 1, answer: 'A' } or
 *                       { number: 2, answer: ['Correct', 'Right'] } or null if invalid.
 */
function parseAnswerLine(lineText) {
  if (!lineText || lineText.trim() === '') {
    return null;
  }

  const cleanedText = cleanAnswerKeyText(lineText);

  // Basic pattern: "1. Answer Text" or "1) Answer Text" or "1 - Answer Text"
  const match = cleanedText.match(/^(\d+)\s*[.)-]\s*(.*)/);
  if (!match) {
    // Log or handle lines that don't start with a number marker if needed
    // console.warn(`Answer key line does not match expected format (Number. Answer): "${lineText}"`);
    return null;
  }

  const questionNumber = parseInt(match[1], 10);
  let answerText = match[2].trim(); // The part after "1. "

  // Retrieve the type determined during question parsing
  const type = questionTypes.get(questionNumber);

  if (!type) {
    console.warn(`Could not find question type for number ${questionNumber} in answer key line: "${lineText}". Skipping.`);
    return null;
  }

  let parsedAnswerData = null;

  // --- Parse answerText based on question type ---
  switch (type) {
    case QUESTION_TYPES.MULTIPLE_CHOICE_SINGLE:
    case QUESTION_TYPES.TRUE_FALSE:
      // Expect a single letter (A, B, C, D, T, F). Allow optional surrounding chars.
      const mcMatch = answerText.match(/^([A-Za-z])\b/); // Match the first letter
      if (mcMatch) {
        parsedAnswerData = mcMatch[1].toUpperCase();
      } else {
        console.warn(`Expected single letter answer for MC/TF question ${questionNumber}, but found: "${answerText}"`);
        return null; // Invalid format for this type
      }
      break;

    case QUESTION_TYPES.MULTIPLE_CHOICE_MULTI:
       // Expect multiple letters, e.g., "A, C", "B D", "A,B,D"
       // Extract all letters, remove duplicates, sort? QTI 1.2 might require specific format.
       // Let's extract unique uppercase letters for now.
       const multiMatch = answerText.toUpperCase().match(/[A-Za-z]/g);
       if (multiMatch) {
           parsedAnswerData = [...new Set(multiMatch)].sort(); // Store as sorted array of unique letters
       } else {
           console.warn(`Expected multiple letters for Multi-MC question ${questionNumber}, but found: "${answerText}"`);
           return null;
       }
       break;

    case QUESTION_TYPES.FILL_IN_BLANK_TEXT:
    case QUESTION_TYPES.SHORT_ANSWER: // Treat similarly, allow multiple possibilities
    case QUESTION_TYPES.ESSAY: // Often no single "correct" answer, but might list key points
      // Split by common delimiters (comma, semicolon) to allow multiple acceptable answers. Trim whitespace.
      // Filter out empty strings that might result from splitting (e.g., "answer, ").
      parsedAnswerData = answerText.split(/[,;]/)
                                    .map(ans => ans.trim())
                                    .filter(ans => ans.length > 0);
      if (parsedAnswerData.length === 0) {
        console.warn(`Parsed empty answer(s) for FIB/SA/Essay question ${questionNumber} from text: "${answerText}"`);
        // Keep empty array? Or return null? Let's keep it to indicate parsing occurred.
      }
      break;

    case QUESTION_TYPES.FILL_IN_BLANK_NUMERIC:
      // Attempt to parse as a number. QTI 1.2 might support ranges or lists.
      // For now, parse a single number. Extend later if needed for ranges/multiple values.
      const num = parseFloat(answerText);
      if (!isNaN(num)) {
        parsedAnswerData = num;
      } else {
        console.warn(`Expected numeric answer for question ${questionNumber}, but found: "${answerText}"`);
        return null; // Invalid format
      }
      break;

    case QUESTION_TYPES.MATCHING:
      // Expect a defined format, e.g., "A=3, B=1, C=2" or "A-3; B-1; C-2"
      // This requires a strict format assumption. Let's assume "Letter=Number" or "Letter-Number" separated by comma/semicolon.
      parsedAnswerData = [];
      const pairs = answerText.split(/[,;]/);
      for (const pairStr of pairs) {
        const pairMatch = pairStr.trim().match(/^([A-Za-z]+)\s*[-=]\s*(\S+)/); // Letter/Word, separator, Anything non-space
        if (pairMatch) {
          parsedAnswerData.push({
            premise: pairMatch[1].trim(), // The identifier on the left (e.g., 'A')
            response: pairMatch[2].trim() // The identifier it matches to (e.g., '3')
          });
        } else {
          console.warn(`Could not parse matching pair "${pairStr}" for question ${questionNumber}. Expected format like 'A=1'.`);
          // Decide: fail all parsing for the question or just skip the bad pair? Let's skip bad pairs.
        }
      }
      if (parsedAnswerData.length === 0) {
          console.warn(`Could not parse any valid matching pairs for question ${questionNumber} from text: "${answerText}"`);
          return null; // Fail if no pairs were found
      }
      break;

    case QUESTION_TYPES.ORDERING:
      // Expect a sequence, e.g., "C, A, B, D" or "3, 1, 4, 2"
      // Split by comma/semicolon or just spaces if no commas/semicolons exist.
      let sequence;
       if (answerText.includes(',') || answerText.includes(';')) {
           sequence = answerText.split(/[,;]/).map(item => item.trim()).filter(item => item.length > 0);
       } else {
           sequence = answerText.split(/\s+/).map(item => item.trim()).filter(item => item.length > 0);
       }

      if (sequence.length > 0) {
        parsedAnswerData = sequence; // Store as an array representing the correct order
      } else {
        console.warn(`Could not parse ordering sequence for question ${questionNumber} from text: "${answerText}"`);
        return null; // Fail if sequence is empty
      }
      break;

    default:
      console.warn(`Answer parsing not implemented for question type "${type}" (Question ${questionNumber}). Text: "${answerText}"`);
      return null; // Unsupported type
  }

  // Return the structured result
  return {
    number: questionNumber,
    answer: parsedAnswerData // The data structure depends on the question type
  };
}


/**
 * Main function to parse the answer key section of the document.
 * Iterates through the document body, identifies the key section,
 * and parses each answer line based on determined question types.
 *
 * @return {Map<number, Object>} A Map where keys are question numbers and
 *                               values are the structured answer data parsed
 *                               by parseAnswerLine (e.g., 'A', ['Correct'], etc.).
 */
function parseAnswerKey() {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const answers = new Map(); // Use a Map for easy lookup by question number
  let foundKey = false;
  let startParsingAnswers = false;

  console.log('Starting answer key parsing...');

  const numChildren = body.getNumChildren();
  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    let text = '';

    // Get text content - handle Paragraph and ListItem
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
      text = child.asParagraph().getText();
    } else if (child.getType() === DocumentApp.ElementType.LIST_ITEM) {
      text = child.asListItem().getText();
    } else {
      continue; // Skip other element types
    }

    text = text.trim();

    // Stage 1: Find the header
    if (!foundKey) {
      if (isAnswerKeyHeader(text)) {
        console.log(`Found answer key header at element index ${i}: "${text}"`);
        foundKey = true;
        startParsingAnswers = true; // Start parsing lines immediately after the header
        continue; // Move to the next element
      }
    }

    // Stage 2: Parse lines after the header
    if (startParsingAnswers && text) {
      const parsedLine = parseAnswerLine(text);
      if (parsedLine) {
        if (answers.has(parsedLine.number)) {
            console.warn(`Duplicate answer found for question number ${parsedLine.number}. Overwriting previous entry.`);
        }
        answers.set(parsedLine.number, parsedLine.answer); // Store the parsed answer data
        console.log(`Parsed answer for Question ${parsedLine.number}:`, parsedLine.answer);
      } else {
          // Optional: Log lines within the answer key section that failed parsing
          // console.log(`Skipped unparseable line in answer key section: "${text}"`);
      }
    } else if (startParsingAnswers && !text) {
        // Optional: Handle empty lines within the answer key section if needed
        // console.log("Skipping empty line in answer key section.");
    }

  } // End loop through document elements

  if (!foundKey) {
    console.warn("Answer key header not found in the document.");
    // Decide whether to throw an error or return an empty map
    // throw new AppError("Answer key not found", "Could not find a section starting with 'Answer Key', 'Answers', or 'Key'. Please add one to the end of your document.");
  }

  console.log(`Finished answer key parsing. Found answers for ${answers.size} questions.`);
  return answers; // Return the Map { number: answerData, ... }
}