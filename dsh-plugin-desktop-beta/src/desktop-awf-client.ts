/**
 * Minimal REST client for the AWF platform.
 *
 * Canonical implementation lives in the shared pure-Node `awf-runner` package
 * (consumed by both desktop editions and the headless awf-node runner); this
 * module re-exports it to keep existing import paths stable.
 */
export * from 'awf-runner/awf-client'
