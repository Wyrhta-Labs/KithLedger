import type { SettingValue } from './types';

export const SETTING_CATEGORY_LABELS: Record<SettingValue['category'], string> = {
  'interaction.type': 'Interaction Types',
  'relationship.type': 'Relationship Types',
};

export function buildSettingValueLabelMap(values: SettingValue[]) {
  return values.reduce<Record<string, Record<string, string>>>((acc, value) => {
    if (!acc[value.category]) acc[value.category] = {};
    acc[value.category][value.value] = value.label;
    return acc;
  }, {});
}

export function getSettingValuesForCategory(values: SettingValue[], category: SettingValue['category']) {
  return values.filter((value) => value.category === category);
}

export function getActiveSettingValues(values: SettingValue[], category: SettingValue['category']) {
  return getSettingValuesForCategory(values, category).filter((value) => value.isActive);
}

export function humanizeSettingValue(value: string) {
  return value
    .split(/[_\-. ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
