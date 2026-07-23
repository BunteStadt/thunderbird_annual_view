import {detector as arrayFunctionReplacements} from './arrayFunctionReplacements.js';
import {detector as arrayReplacements} from './arrayReplacements.js';
import {detector as augmentedArrayFunctionReplacements} from './augmentedArrayFunctionReplacements.js';
import {detector as augmentedArrayReplacements} from './augmentedArrayReplacements.js';
import {detector as augmentedProxiedArrayFunctionReplacements} from './augmentedProxiedArrayFunctionReplacements.js';
import {detector as caesarPlus} from './caesarPlus.js';
import {detector as functionToArrayReplacements} from './functionToArrayReplacements.js';
import {detector as obfuscatorIo} from './obfuscatorIo.js';

const detectors = [
  arrayReplacements,
  arrayFunctionReplacements,
  augmentedArrayReplacements,
  augmentedArrayFunctionReplacements,
  augmentedProxiedArrayFunctionReplacements,
  functionToArrayReplacements,
  obfuscatorIo,
  caesarPlus,
];

function getDetectorMap(detectorsList = detectors) {
  return new Map(detectorsList.map(detector => [detector.name, detector]));
}

function validateDetectors(detectorsList = detectors) {
  const detectorMap = getDetectorMap(detectorsList);

  if (detectorMap.size !== detectorsList.length) {
    throw new Error('Duplicate detector names are not allowed');
  }

  for (const detector of detectorsList) {
    for (const prioritizedName of detector.prioritizeOver) {
      if (!detectorMap.has(prioritizedName)) {
        throw new Error(`Detector "${detector.name}" prioritizes over unknown detector "${prioritizedName}"`);
      }
    }
  }

  const visited = new Set();
  const active = new Set();

  function visit(detectorName) {
    if (active.has(detectorName)) {
      throw new Error(`Cycle detected in prioritizeOver graph at "${detectorName}"`);
    }
    if (visited.has(detectorName)) return;

    active.add(detectorName);
    const detector = detectorMap.get(detectorName);
    detector.prioritizeOver.forEach(visit);
    active.delete(detectorName);
    visited.add(detectorName);
  }

  detectorsList.forEach(detector => visit(detector.name));
}

validateDetectors();

export {detectors, getDetectorMap, validateDetectors};
