import { BadRequestException } from '@nestjs/common';

export enum DataSourcePropertyType {
  Title = 'title',
  Text = 'text',
  Number = 'number',
  Select = 'select',
  MultiSelect = 'multi_select',
  Date = 'date',
  Checkbox = 'checkbox',
  Person = 'person',
  Url = 'url',
  Email = 'email',
  Phone = 'phone',
}

export const DATA_SOURCE_PROPERTY_TYPES = Object.values(
  DataSourcePropertyType,
);

type SelectOption = {
  id: string;
  name: string;
  color?: string;
  sortKey: string;
  archived?: boolean;
};

type NormalizedPropertyValue = {
  valueJson: unknown;
  textValue: string | null;
  numberValue: number | null;
  dateValue: Date | null;
  boolValue: boolean | null;
};

export function normalizePropertyValue(input: {
  type: string;
  value: unknown;
  config?: Record<string, any> | null;
  allowArchivedSelectOptions?: boolean;
}): NormalizedPropertyValue {
  const empty = {
    textValue: null,
    numberValue: null,
    dateValue: null,
    boolValue: null,
  };

  if (input.value === null || input.value === undefined) {
    return { valueJson: null, ...empty };
  }

  if (isTextType(input.type)) {
    if (typeof input.value !== 'string') {
      throw new BadRequestException('Value must be a string');
    }
    const text = input.value.trim();
    return {
      valueJson: text.length ? text : null,
      textValue: text.length ? text : null,
      numberValue: null,
      dateValue: null,
      boolValue: null,
    };
  }

  if (input.type === DataSourcePropertyType.Number) {
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
      throw new BadRequestException('Value must be a number');
    }
    return {
      valueJson: input.value,
      textValue: null,
      numberValue: input.value,
      dateValue: null,
      boolValue: null,
    };
  }

  if (input.type === DataSourcePropertyType.Checkbox) {
    if (typeof input.value !== 'boolean') {
      throw new BadRequestException('Value must be a boolean');
    }
    return {
      valueJson: input.value,
      textValue: null,
      numberValue: null,
      dateValue: null,
      boolValue: input.value,
    };
  }

  if (input.type === DataSourcePropertyType.Date) {
    if (!isDateValue(input.value)) {
      throw new BadRequestException('Value must be a date object');
    }
    const date = new Date(input.value.start);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date start is invalid');
    }
    const valueJson = normalizeDateValue(input.value);
    return {
      valueJson,
      textValue: null,
      numberValue: null,
      dateValue: date,
      boolValue: null,
    };
  }

  if (input.type === DataSourcePropertyType.Select) {
    if (typeof input.value !== 'string') {
      throw new BadRequestException('Value must be an option id');
    }
    const option = getActiveOption(
      input.config,
      input.value,
      input.allowArchivedSelectOptions,
    );
    return {
      valueJson: input.value,
      textValue: option.sortKey,
      numberValue: null,
      dateValue: null,
      boolValue: null,
    };
  }

  if (input.type === DataSourcePropertyType.MultiSelect) {
    if (
      !Array.isArray(input.value) ||
      input.value.some((value) => typeof value !== 'string')
    ) {
      throw new BadRequestException('Value must be option ids');
    }
    const optionIds = uniqueStrings(input.value);
    for (const value of optionIds) {
      getActiveOption(input.config, value, input.allowArchivedSelectOptions);
    }
    return { valueJson: optionIds, ...empty };
  }

  if (input.type === DataSourcePropertyType.Person) {
    if (
      !Array.isArray(input.value) ||
      input.value.some((value) => typeof value !== 'string')
    ) {
      throw new BadRequestException('Value must be user ids');
    }
    return { valueJson: uniqueStrings(input.value), ...empty };
  }

  throw new BadRequestException('Unsupported property type');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isTextType(type: string): boolean {
  return [
    DataSourcePropertyType.Title,
    DataSourcePropertyType.Text,
    DataSourcePropertyType.Url,
    DataSourcePropertyType.Email,
    DataSourcePropertyType.Phone,
  ].includes(type as DataSourcePropertyType);
}

function isDateValue(
  value: unknown,
): value is { start: string; end?: string; timeZone?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).start === 'string'
  );
}

function normalizeDateValue(value: {
  start: string;
  end?: string;
  timeZone?: string;
}): { start: string; end?: string; timeZone?: string } {
  const normalized: { start: string; end?: string; timeZone?: string } = {
    start: value.start,
  };

  if (value.end !== undefined) {
    if (typeof value.end !== 'string') {
      throw new BadRequestException('Date end is invalid');
    }
    const startDate = new Date(value.start);
    const endDate = new Date(value.end);
    if (Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('Date end is invalid');
    }
    if (endDate < startDate) {
      throw new BadRequestException('Date end cannot be before start date');
    }
    normalized.end = value.end;
  }

  if (value.timeZone !== undefined) {
    if (typeof value.timeZone !== 'string') {
      throw new BadRequestException('Date timeZone is invalid');
    }
    normalized.timeZone = value.timeZone;
  }

  return normalized;
}

function getActiveOption(
  config: Record<string, any> | null | undefined,
  optionId: string,
  allowArchived = false,
): SelectOption {
  const options = Array.isArray(config?.options)
    ? (config.options as SelectOption[])
    : [];
  const option = options.find((item) => item.id === optionId);
  if (
    !option ||
    (!allowArchived && option.archived) ||
    typeof option.id !== 'string' ||
    typeof option.sortKey !== 'string'
  ) {
    throw new BadRequestException('Select option not found');
  }
  return option;
}
