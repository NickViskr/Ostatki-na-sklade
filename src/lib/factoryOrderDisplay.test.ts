import { describe, it, expect } from 'vitest';
import { FactoryOrder } from '../types';
import {
  isChinaFactoryOrder, factoryOrderBadge, factoryLateLabel,
  forecastPipelineStatus, forecastPipelineStatusLabel
} from './factoryOrderDisplay';

const order = (patch: Partial<FactoryOrder>): FactoryOrder => ({
  id: 'o1', article: 'ART-1', orderedAt: '2026-09-01', qty: 10, expectedAt: '2026-10-01',
  comment: '', user: '', status: 'active', receivedAt: '', source: '', chinaOrderNo: '',
  chinaBatchCode: '', chinaKey: '', checked: false, ...patch
});

describe('isChinaFactoryOrder', () => {
  it('is true for both China sources, false for a manual row', () => {
    expect(isChinaFactoryOrder(order({ source: 'Китай' }))).toBe(true);
    expect(isChinaFactoryOrder(order({ source: 'Китай прогноз' }))).toBe(true);
    expect(isChinaFactoryOrder(order({ source: '' }))).toBe(false);
  });
});

describe('factoryOrderBadge', () => {
  it('shows the batch code for a shipped China row', () => {
    expect(factoryOrderBadge(order({ source: 'Китай', chinaBatchCode: 'NV-0923-4' }))).toBe('Китай · NV-0923-4');
  });
  it('shows the order number for a forecast row, and nothing for a manual row', () => {
    expect(factoryOrderBadge(order({ source: 'Китай прогноз', chinaOrderNo: '31' }))).toBe('Китай · прогноз, заказ 31');
    expect(factoryOrderBadge(order({ source: '' }))).toBe('');
  });
});

describe('factoryLateLabel', () => {
  it('renders the day count when late, empty string otherwise', () => {
    expect(factoryLateLabel(5)).toBe('задерживается 5 дн');
    expect(factoryLateLabel(0)).toBe('');
    expect(factoryLateLabel(undefined)).toBe('');
  });
});

describe('forecastPipelineStatus / forecastPipelineStatusLabel', () => {
  it('is inPipeline only with both an order number and a ship date and no batch yet', () => {
    expect(forecastPipelineStatus({ orderNo: '31', expectedShipAt: '2026-10-01' }, false)).toBe('inPipeline');
    expect(forecastPipelineStatus({ orderNo: '', expectedShipAt: '2026-10-01' }, false)).toBe('notInPipeline');
    expect(forecastPipelineStatus({ orderNo: '31', expectedShipAt: '' }, false)).toBe('notInPipeline');
  });
  it('is replaced once a batch of the same order exists, regardless of the rest', () => {
    expect(forecastPipelineStatus({ orderNo: '31', expectedShipAt: '2026-10-01' }, true)).toBe('replaced');
  });
  it('labels every status in Russian for the owner', () => {
    expect(forecastPipelineStatusLabel('inPipeline')).toBe('в трубе');
    expect(forecastPipelineStatusLabel('replaced')).toBe('заменён партией');
    expect(forecastPipelineStatusLabel('notInPipeline')).toBe('не в трубе: нет номера заказа или даты');
  });
});
