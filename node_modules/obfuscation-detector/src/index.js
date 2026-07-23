/**
 * Main entry points for obfuscation detection.
 * @module obfuscation-detector
 */

import {generateFlatAST, logger} from 'flast';
import {detectors, getDetectorMap} from './detectors/index.js';

function getSuppressedNames(detectorName, detectorMap, visited = new Set()) {
  if (visited.has(detectorName)) return visited;

  visited.add(detectorName);
  const detector = detectorMap.get(detectorName);

  detector?.prioritizeOver.forEach(prioritizedName => {
    getSuppressedNames(prioritizedName, detectorMap, visited);
  });

  return visited;
}

function createDetailedResults(code) {
  const detectedNames = [];
  const detectorMap = getDetectorMap();

  try {
    const tree = generateFlatAST(code);
    for (const detector of detectors) {
      try {
        if (detector.detect(tree, detectedNames)) {
          detectedNames.push(detector.name);
        }
      } catch (e) {
        logger.debug(`Error while running ${detector.name}: ${e.message}`);
      }
    }
  } catch (e) {
    logger.debug(e.message);
  }

  return detectedNames.map(name => {
    const suppressedBy = detectedNames.filter(otherName => {
      if (otherName === name) return false;
      return getSuppressedNames(otherName, detectorMap).has(name);
    });

    return {
      name,
      prioritizeOver: [...detectorMap.get(name).prioritizeOver],
      suppressedBy,
    };
  });
}

function detectObfuscationDetailed(code) {
  return createDetailedResults(code);
}

function detectObfuscation(code) {
  return createDetailedResults(code).map(result => result.name);
}

function detectObfuscationReduced(code) {
  return createDetailedResults(code)
    .filter(result => !result.suppressedBy.length)
    .map(result => result.name);
}

export {detectObfuscation, detectObfuscationDetailed, detectObfuscationReduced};
