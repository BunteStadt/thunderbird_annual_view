import {arrayIsProvidedAsArgumentToIIFE, findArrayDeclarationCandidates, functionHasMinimumRequiredReferences} from './sharedDetectionMethods.js';

const name = 'augmented_array_function_replacements';

/**
 * Detects the Augmented Array-Function Replacements obfuscation type.
 *
 * Characteristics:
 * - The same characteristics as an Array-Function Replacements obfuscation type.
 * - An IIFE with a reference to Array A as one of its arguments.
 *
 * @param {ASTNode[]} flatTree - The flattened AST of the code.
 * @returns {string} The obfuscation name if detected; otherwise, an empty string.
 */
function detectAugmentedArrayFunctionReplacements(flatTree) {
  const candidates = findArrayDeclarationCandidates(flatTree);

  const isFound = candidates.some(c => {
    if (c.id.references.length > 2) return false;
    const refs = c.id.references;
    const refsParents = c.id.references.map(n => n.parentNode);
    const iife = arrayIsProvidedAsArgumentToIIFE(refsParents, c.id.name);
    if (!iife) return false;
    const iifeIdentifier = iife.arguments.find(arg => refs.includes(arg));
    const arrayIdentifierInTargetFunc = refs.find(ref => ref !== iifeIdentifier);
    return functionHasMinimumRequiredReferences(arrayIdentifierInTargetFunc, flatTree);
  });
  return isFound;
}

const detector = {
  name,
  prioritizeOver: ['array_function_replacements'],
  detect: detectAugmentedArrayFunctionReplacements,
};

export {detector, detectAugmentedArrayFunctionReplacements};
