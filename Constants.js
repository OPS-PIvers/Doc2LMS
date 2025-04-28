/**
 * Constants.gs – Global constants.
 * Updated to reflect QTI 1.2 focus.
 */

// Define constants for question types supported by the QTI 1.2 export.
// Using descriptive strings for clarity in code and logs.
const QUESTION_TYPES = {
  MULTIPLE_CHOICE_SINGLE: "multiple_choice_single", // QTI: response_lid (Single Cardinality)
  MULTIPLE_CHOICE_MULTI: "multiple_choice_multi",   // QTI: response_lid (Multiple Cardinality) - Note: QTI 1.2 multi-response is complex
  TRUE_FALSE: "true_false",                         // QTI: response_lid (like MC Single with T/F options)
  FILL_IN_BLANK_TEXT: "fill_in_blank_text",         // QTI: response_str
  FILL_IN_BLANK_NUMERIC: "fill_in_blank_numeric",   // QTI: response_num
  ESSAY: "essay",                                   // QTI: response_str (usually manually graded)
  SHORT_ANSWER: "short_answer",                     // QTI: response_str (can have respcondition matching)
  MATCHING: "matching",                             // QTI: response_lid (Multiple Cardinality, complex setup)
  ORDERING: "ordering"                              // QTI: response_lid (Multiple Cardinality, complex setup)
  // Add other types if needed and feasible within QTI 1.2
};

// Global Map to store the determined type for each question number during parsing.
// This is crucial for linking questions to correctly parsed answers and guiding export.
const questionTypes = new Map();