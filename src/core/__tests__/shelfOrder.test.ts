import { describe, expect, it } from 'vitest'
import { ShelfOrder } from '../shelfOrder'

// Port of ShelfOrderTests.swift.

const defaults = ['continue', 'wanted', 'upcoming', 'recent:1', 'recent:2', 'similar', 'because', 'cast']

describe('ShelfOrder', () => {
  it('nothing saved: the default order', () => {
    expect(ShelfOrder.arrange([], defaults)).toEqual(defaults)
  })

  it('the saved order wins', () => {
    const saved = ['cast', 'recent:2', 'continue', 'wanted', 'upcoming', 'recent:1', 'similar', 'because']
    expect(ShelfOrder.arrange(saved, defaults)).toEqual(saved)
  })

  it('a new shelf lands after the one it follows by default', () => {
    // A library added since: right after recent:1.
    expect(ShelfOrder.arrange(['wanted', 'recent:1', 'continue', 'upcoming', 'similar', 'because', 'cast'], defaults)).toEqual([
      'wanted',
      'recent:1',
      'recent:2',
      'continue',
      'upcoming',
      'similar',
      'because',
      'cast',
    ])
    // Right after its default predecessor wherever that went; the first default shelf: first.
    expect(ShelfOrder.arrange(['wanted', 'continue'], ['continue', 'wanted', 'upcoming'])).toEqual(['wanted', 'upcoming', 'continue'])
    expect(ShelfOrder.arrange(['upcoming', 'wanted'], ['continue', 'wanted', 'upcoming'])).toEqual(['continue', 'upcoming', 'wanted'])
  })

  it('unknown and repeated ids are dropped', () => {
    expect(ShelfOrder.arrange(['recent:9', 'cast', 'cast', 'continue'], ['continue', 'recent:1', 'cast'])).toEqual(['cast', 'continue', 'recent:1'])
  })

  it('saving keeps the shelves of another server in their places', () => {
    expect(ShelfOrder.save(['wanted', 'continue', 'cast'], ['continue', 'recent:9', 'wanted', 'cast'])).toEqual(['wanted', 'continue', 'recent:9', 'cast'])
    expect(ShelfOrder.save(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('move clamps at the ends', () => {
    const order = ['a', 'b', 'c']
    expect(ShelfOrder.move(order, 1, -1)).toEqual(['b', 'a', 'c'])
    expect(ShelfOrder.move(order, 1, 1)).toEqual(['a', 'c', 'b'])
    expect(ShelfOrder.move(order, 0, -1)).toEqual(order)
    expect(ShelfOrder.move(order, 2, 1)).toEqual(order)
    expect(ShelfOrder.move(order, 5, 1)).toEqual(order)
    expect(order).toEqual(['a', 'b', 'c']) // not changed in place
  })
})
