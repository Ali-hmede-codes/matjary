import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { BoostBidStrategy } from '../../libs/database/src/entities';
import {
  billableDeliveryCoins,
  coinAmount,
} from '../../apps/api/src/modules/boost/boost.service';

test('coin amounts stay integer-only and bounded', () => {
  assert.equal(coinAmount('1000'), 1000n);
  assert.equal(coinAmount(-25, true), -25n);
  for (const value of ['1.5', '01', '-1', '', '1e3', Infinity]) {
    assert.throws(() => coinAmount(value), BadRequestException);
  }
  assert.throws(
    () => coinAmount(String(Number.MAX_SAFE_INTEGER + 1)),
    BadRequestException,
  );
});

test('campaign delivery bills clicks and completed impression blocks only', () => {
  assert.equal(
    billableDeliveryCoins(BoostBidStrategy.CPC, '4', 1, 'clicks', 0n),
    4n,
  );
  assert.equal(
    billableDeliveryCoins(BoostBidStrategy.CPC, '4', 1, 'impressions', 1000n),
    0n,
  );
  assert.equal(
    billableDeliveryCoins(BoostBidStrategy.AUTO, null, 2, 'clicks', 0n),
    2n,
  );
  assert.equal(
    billableDeliveryCoins(BoostBidStrategy.AUTO, null, 2, 'impressions', 1000n),
    0n,
  );
  assert.equal(
    billableDeliveryCoins(BoostBidStrategy.CPM, '25', 1, 'impressions', 999n),
    0n,
  );
  assert.equal(
    billableDeliveryCoins(BoostBidStrategy.CPM, '25', 1, 'impressions', 1000n),
    25n,
  );
  assert.equal(
    billableDeliveryCoins(BoostBidStrategy.CPM, '25', 1, 'clicks', 1000n),
    0n,
  );
  assert.equal(
    billableDeliveryCoins(BoostBidStrategy.CPM, null, 1, 'impressions', 1000n),
    0n,
  );
});
