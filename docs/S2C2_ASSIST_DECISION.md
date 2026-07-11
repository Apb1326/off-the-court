# S2c2 assist-definition decision

S2c2 adopts the measurement-side **scorekeeper-aligned assisted proxy**:

> chain-assisted makes + zero-pass makes whose initial play type is `spot_up`
> or `off_screen`.

The strict chain remains the sole engine assist-credit mechanism. No stat credit,
persisted event, RNG draw, or active-pool simulation behavior changes here.

The S1-Rb diagnostic found that the chain's corner kick-out routing was sound
(about 90% of corner attempts ended as spot-up catches) but its strict
pass-into-the-make definition undercounted those initial-actor catch-and-shoot
makes. The proxy reproduced the observed sign structure: corner three 94.2%
versus the NBA reference 96.7%, highest by a wide margin.

This is a proxy that reproduces the observed sign structure, not a
possession-level reconstruction of NBA scorekeeper decisions: an initial
spot-up or off-screen make is not guaranteed to have followed a pass that
would receive an official assist.

The enforced anchor remains the strict-chain box assist total of 26.66 per
team-game; per-zone rates remain informational. Deliberately loosening engine
assist-credit mechanics was considered and explicitly not chosen. If wanted,
that is an S3.g engine-mechanics item. The proxy rates are reference data
eligible for S2d's `PLAY_TYPE_PASS_RATE` retune; S2c2 does not change it.
