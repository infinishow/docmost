import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePropertyValueDto } from '../dto/property-value.dto';
import {
  DataSourcePropertyType,
  normalizePropertyValue,
} from './property-value-normalizer';

describe('normalizePropertyValue', () => {
  it('normalizes text-like values into textValue', () => {
    expect(
      normalizePropertyValue({
        type: DataSourcePropertyType.Text,
        value: '  hello  ',
      }),
    ).toEqual({
      valueJson: 'hello',
      textValue: 'hello',
      numberValue: null,
      dateValue: null,
      boolValue: null,
    });
  });

  it('normalizes number values into numberValue', () => {
    expect(
      normalizePropertyValue({
        type: DataSourcePropertyType.Number,
        value: 12.5,
      }),
    ).toMatchObject({
      valueJson: 12.5,
      numberValue: 12.5,
    });
  });

  it('rejects invalid number values', () => {
    expect(() =>
      normalizePropertyValue({
        type: DataSourcePropertyType.Number,
        value: '12',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects non-finite number values', () => {
    expect(() =>
      normalizePropertyValue({
        type: DataSourcePropertyType.Number,
        value: Infinity,
      }),
    ).toThrow(BadRequestException);
  });

  it('uses select option sortKey for textValue', () => {
    const normalized = normalizePropertyValue({
      type: DataSourcePropertyType.Select,
      value: 'todo',
      config: { options: [{ id: 'todo', name: 'Todo', sortKey: '001' }] },
    });

    expect(normalized.textValue).toBe('001');
  });

  it('deduplicates multi select option ids while preserving order', () => {
    const normalized = normalizePropertyValue({
      type: DataSourcePropertyType.MultiSelect,
      value: ['todo', 'done', 'todo'],
      config: {
        options: [
          { id: 'todo', name: 'Todo', sortKey: '001' },
          { id: 'done', name: 'Done', sortKey: '002' },
        ],
      },
    });

    expect(normalized.valueJson).toEqual(['todo', 'done']);
  });

  it('deduplicates person user ids while preserving order', () => {
    const normalized = normalizePropertyValue({
      type: DataSourcePropertyType.Person,
      value: ['user-1', 'user-2', 'user-1'],
    });

    expect(normalized.valueJson).toEqual(['user-1', 'user-2']);
  });

  it('rejects archived select options for new writes', () => {
    expect(() =>
      normalizePropertyValue({
        type: DataSourcePropertyType.Select,
        value: 'old',
        config: {
          options: [
            { id: 'old', name: 'Old', sortKey: '999', archived: true },
          ],
        },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed select options', () => {
    expect(() =>
      normalizePropertyValue({
        type: DataSourcePropertyType.Select,
        value: 'todo',
        config: { options: [{ id: 'todo', name: 'Todo' }] },
      }),
    ).toThrow(BadRequestException);
  });

  it('normalizes date values into canonical valueJson and dateValue', () => {
    const normalized = normalizePropertyValue({
      type: DataSourcePropertyType.Date,
      value: {
        start: '2026-06-11T00:00:00.000Z',
        end: '2026-06-12T00:00:00.000Z',
        timeZone: 'UTC',
        ignored: true,
      },
    });

    expect(normalized).toEqual({
      valueJson: {
        start: '2026-06-11T00:00:00.000Z',
        end: '2026-06-12T00:00:00.000Z',
        timeZone: 'UTC',
      },
      textValue: null,
      numberValue: null,
      dateValue: new Date('2026-06-11T00:00:00.000Z'),
      boolValue: null,
    });
  });

  it('canonicalizes timezone-less date strings to UTC ISO strings', () => {
    const normalized = normalizePropertyValue({
      type: DataSourcePropertyType.Date,
      value: {
        start: '2026-06-11',
        end: '2026-06-12',
      },
    });

    expect(normalized.valueJson).toEqual({
      start: '2026-06-11T00:00:00.000Z',
      end: '2026-06-12T00:00:00.000Z',
    });
    expect(normalized.dateValue).toEqual(
      new Date('2026-06-11T00:00:00.000Z'),
    );
  });

  it('rejects invalid date time zones', () => {
    expect(() =>
      normalizePropertyValue({
        type: DataSourcePropertyType.Date,
        value: {
          start: '2026-06-11T00:00:00.000Z',
          timeZone: 'Invalid/Zone',
        },
      }),
    ).toThrow('Date timeZone is invalid');
  });

  it('rejects malformed date optional fields', () => {
    expect(() =>
      normalizePropertyValue({
        type: DataSourcePropertyType.Date,
        value: { start: '2026-06-11T00:00:00.000Z', end: 123 },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects date ranges whose end is before start', () => {
    expect(() =>
      normalizePropertyValue({
        type: DataSourcePropertyType.Date,
        value: {
          start: '2026-06-12T00:00:00.000Z',
          end: '2026-06-11T00:00:00.000Z',
        },
      }),
    ).toThrow('Date end cannot be before start date');
  });

  it('keeps arbitrary value payloads when class-validator whitelisting runs', async () => {
    const dto = plainToInstance(UpdatePropertyValueDto, {
      recordId: '11111111-1111-4111-8111-111111111111',
      propertyId: '22222222-2222-4222-8222-222222222222',
      value: { nested: true },
      extra: 'remove-me',
    });

    const errors = await validate(dto, { whitelist: true });

    expect(errors).toEqual([]);
    expect(dto.value).toEqual({ nested: true });
    expect((dto as any).extra).toBeUndefined();
  });
});
