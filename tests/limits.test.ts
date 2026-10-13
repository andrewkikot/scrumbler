import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { idleRoomDays, MIN_IDLE_ROOM_DAYS } from '../src/lib/cleanup';
import { clientAddress, windowStartFor } from '../src/lib/limits';

const withHeaders = (headers: Record<string, string>) =>
  new Request('http://localhost/api/rooms', { method: 'POST', headers });

describe('rate limit windows', () => {
  it('puts every moment of a window on the same start', () => {
    const hour = 3_600_000;
    assert.equal(windowStartFor(5 * hour, hour), 5 * hour);
    assert.equal(windowStartFor(5 * hour + 59 * 60_000, hour), 5 * hour);
    assert.equal(windowStartFor(6 * hour, hour), 6 * hour);
  });
});

describe('client address', () => {
  it('takes the first hop of x-forwarded-for', () => {
    assert.equal(clientAddress(withHeaders({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7');
  });

  it('falls back to x-real-ip, then to "local"', () => {
    assert.equal(clientAddress(withHeaders({ 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
    assert.equal(clientAddress(withHeaders({})), 'local');
  });
});

describe('idle room sweep', () => {
  it('is off unless configured', () => {
    assert.equal(idleRoomDays({}), null);
    assert.equal(idleRoomDays({ SCRUMBLER_ROOM_IDLE_DAYS: '' }), null);
    assert.equal(idleRoomDays({ SCRUMBLER_ROOM_IDLE_DAYS: 'soon' }), null);
    assert.equal(idleRoomDays({ SCRUMBLER_ROOM_IDLE_DAYS: '0' }), null);
  });

  it('reads the prefixed name first', () => {
    assert.equal(idleRoomDays({ SCRUMBLER_ROOM_IDLE_DAYS: '90', ROOM_IDLE_DAYS: '400' }), 90);
    assert.equal(idleRoomDays({ ROOM_IDLE_DAYS: '400' }), 400);
  });

  it('never sweeps rooms idle for less than the floor', () => {
    assert.equal(idleRoomDays({ SCRUMBLER_ROOM_IDLE_DAYS: '3' }), MIN_IDLE_ROOM_DAYS);
  });
});
