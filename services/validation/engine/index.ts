/**
 * @merch-os/validation — Validation Engine.
 *
 * Deterministic export gatekeeper: validates a CanonicalProduct against a
 * target marketplace schema and produces a typed ValidationResult. Pure and
 * side-effect free; the Schema Registry lookup and the Lambda wiring live in
 * separate layers.
 */

export { validate, isValidGtin, type ValidateInput } from './validation-engine.js';
export {
  mapCanonicalToTakealot,
  type TakealotFieldMap,
  type MapOptions,
} from './canonical-to-takealot.js';
