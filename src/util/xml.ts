import { XMLParser } from 'fast-xml-parser';

/**
 * Shared OOXML parser config used across the template extractors and the
 * document-context reader. Keeps namespace prefixes (`a:`, `p:`, `w:`) so we
 * can navigate the tree semantically, and surfaces attributes under `@_`.
 */
export const ooxmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
});

/**
 * Like `ooxmlParser` but preserves whitespace in text nodes. Word and
 * PowerPoint split a sentence across multiple runs and rely on
 * `xml:space="preserve"` to keep the spaces between them; trimming would glue
 * adjacent run text together ("Para " + "two" → "Paratwo"). Use this when
 * reading `<w:t>` / `<a:t>` content for text extraction.
 */
export const ooxmlTextParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  trimValues: false,
});
