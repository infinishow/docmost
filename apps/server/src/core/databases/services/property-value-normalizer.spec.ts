import { BadRequestException } from '@nestjs/common';
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

  it('uses select option sortKey for textValue', () => {
    const normalized = normalizePropertyValue({
      type: DataSourcePropertyType.Select,
      value: 'todo',
      config: { options: [{ id: 'todo', name: 'Todo', sortKey: '001' }] },
    });

    expect(normalized.textValue).toBe('001');
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
});
