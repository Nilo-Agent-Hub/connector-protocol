// SPDX-License-Identifier: MIT
import type { RuntimeReport, RuntimeSelection } from './runtime.js';

/** Reject an unavailable frozen selection before making any upstream call. */
export function assertRuntimeSelection(selection: RuntimeSelection, report: RuntimeReport): void {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown) => typeof v === 'string' && v.length > 0 && new TextEncoder().encode(v).length <= 256;
  const invalid = () => { throw new Error('Session selection is invalid or no longer supported'); };
  if (!report.capabilities.sessionSelection || !object(selection) || Object.keys(selection).some(k => !['model', 'effort', 'settings'].includes(k))) invalid();
  if ('model' in selection) {
    const model = selection.model;
    if (!object(model) || Object.keys(model).some(k => !['model', 'provider'].includes(k)) || !text(model.model) || !text(model.provider)) invalid();
    const choice = report.models.find(item => item.model === model?.model && item.provider === model?.provider);
    if (!report.capabilities.switchModel || !choice) invalid();
    if ('effort' in selection && (!text(selection.effort) || !report.capabilities.reasoning || !choice?.reasoningEfforts?.some(item => item.id === selection.effort))) invalid();
  } else if ('effort' in selection) invalid();
  if ('settings' in selection) {
    if (!object(selection.settings) || Object.keys(selection.settings).length > 64) invalid();
    const entries = Object.entries(selection.settings!);
    if (entries.length && !report.capabilities.updateSettings) invalid();
    for (const [key, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || !(value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && new TextEncoder().encode(value).length <= 1024)
        || !report.settings?.allowed[key]?.some(option => option === value)) invalid();
    }
  }
}

/** Changing a model drops inherited effort; null settings remain literal values. */
export function mergeRuntimeSelection(defaults?: RuntimeSelection | null, override?: RuntimeSelection): RuntimeSelection {
  const out = { ...defaults, ...override };
  if (override?.model && (override.model.model !== defaults?.model?.model || override.model.provider !== defaults?.model?.provider) && override.effort === undefined) delete out.effort;
  if (defaults?.settings || override?.settings) out.settings = { ...defaults?.settings, ...override?.settings };
  return out;
}
