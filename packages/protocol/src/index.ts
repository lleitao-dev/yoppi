import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const GameTypeSchema = z.enum(['BLACKJACK', 'POKER']);
export type GameType = z.infer<typeof GameTypeSchema>;

export const RoomStatusSchema = z.enum(['WAITING', 'ACTIVE', 'COMPLETE', 'CLOSED']);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

export const ParticipationStatusSchema = z.enum(['WAITING', 'PLAYING', 'QUEUED', 'LEAVING']);
export type ParticipationStatus = z.infer<typeof ParticipationStatusSchema>;

export const PlayerViewSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
});
export type PlayerView = z.infer<typeof PlayerViewSchema>;

export const SessionResponseSchema = z.object({
  player: PlayerViewSchema,
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const CreateSessionRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(24),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const CreateRoomRequestSchema = z.object({
  gameType: GameTypeSchema,
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const JoinRoomRequestSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/),
});
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>;

export const RoomPlayerViewSchema = z.object({
  playerId: z.string().uuid(),
  displayName: z.string(),
  seat: z.number().int().nonnegative().nullable(),
  connected: z.boolean(),
  isHost: z.boolean(),
  joinedAt: z.string().datetime(),
  participation: ParticipationStatusSchema,
});
export type RoomPlayerView = z.infer<typeof RoomPlayerViewSchema>;

export const PlayerRequirementViewSchema = z.object({
  minimum: z.number().int().positive(),
  current: z.number().int().nonnegative(),
  graceDeadline: z.string().datetime().nullable(),
});
export type PlayerRequirementView = z.infer<typeof PlayerRequirementViewSchema>;

export const RoomViewSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  gameType: GameTypeSchema,
  status: RoomStatusSchema,
  hostPlayerId: z.string().uuid(),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
  canStart: z.boolean(),
  playerRequirement: PlayerRequirementViewSchema,
  revision: z.number().int().nonnegative(),
  players: z.array(RoomPlayerViewSchema),
});
export type RoomView = z.infer<typeof RoomViewSchema>;

export const RoomResponseSchema = z.object({ room: RoomViewSchema });
export type RoomResponse = z.infer<typeof RoomResponseSchema>;

export const RoomSubscribeSchema = z.object({ roomId: z.string().uuid() });
export type RoomSubscribePayload = z.infer<typeof RoomSubscribeSchema>;

export const RoomLeaveSchema = z.object({ roomId: z.string().uuid() });
export type RoomLeavePayload = z.infer<typeof RoomLeaveSchema>;

export const GameStartSchema = z.object({ roomId: z.string().uuid() });
export type GameStartPayload = z.infer<typeof GameStartSchema>;

export const CardSuitSchema = z.enum(['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES']);
export type CardSuit = z.infer<typeof CardSuitSchema>;

export const CardRankSchema = z.enum(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
export type CardRank = z.infer<typeof CardRankSchema>;

export const CardViewSchema = z.object({
  rank: CardRankSchema,
  suit: CardSuitSchema,
});
export type CardView = z.infer<typeof CardViewSchema>;

export const BlackjackPhaseSchema = z.enum(['BETTING', 'PLAYER_TURNS', 'DEALER_TURN', 'ROUND_COMPLETE']);
export type BlackjackPhase = z.infer<typeof BlackjackPhaseSchema>;

export const BlackjackPlayerStatusSchema = z.enum([
  'BETTING',
  'PLAYING',
  'STANDING',
  'BLACKJACK',
  'BUST',
  'DONE',
  'OUT',
]);
export type BlackjackPlayerStatus = z.infer<typeof BlackjackPlayerStatusSchema>;

export const BlackjackResultSchema = z.enum(['BLACKJACK', 'WIN', 'PUSH', 'LOSE', 'BUST']);
export type BlackjackResult = z.infer<typeof BlackjackResultSchema>;

export const BlackjackActionSchema = z.enum(['BET', 'HIT', 'STAND', 'DOUBLE', 'NEXT_ROUND']);
export type BlackjackAction = z.infer<typeof BlackjackActionSchema>;

export const BlackjackPlayerViewSchema = z.object({
  playerId: z.string().uuid(),
  displayName: z.string(),
  seat: z.number().int().nonnegative(),
  chips: z.number().int().nonnegative(),
  bet: z.number().int().nonnegative(),
  cards: z.array(CardViewSchema),
  total: z.number().int().nonnegative(),
  soft: z.boolean(),
  status: BlackjackPlayerStatusSchema,
  result: BlackjackResultSchema.nullable(),
  net: z.number().int(),
});
export type BlackjackPlayerView = z.infer<typeof BlackjackPlayerViewSchema>;

export const BlackjackDealerViewSchema = z.object({
  cards: z.array(CardViewSchema.nullable()),
  total: z.number().int().nonnegative().nullable(),
  soft: z.boolean().nullable(),
});
export type BlackjackDealerView = z.infer<typeof BlackjackDealerViewSchema>;

export const BlackjackStateViewSchema = z.object({
  roomId: z.string().uuid(),
  round: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  phase: BlackjackPhaseSchema,
  currentPlayerId: z.string().uuid().nullable(),
  minBet: z.number().int().positive(),
  maxBet: z.number().int().positive(),
  dealer: BlackjackDealerViewSchema,
  players: z.array(BlackjackPlayerViewSchema),
  allowedActions: z.array(BlackjackActionSchema),
});
export type BlackjackStateView = z.infer<typeof BlackjackStateViewSchema>;

export const BlackjackBetSchema = z.object({
  roomId: z.string().uuid(),
  amount: z.number().int().positive(),
});
export type BlackjackBetPayload = z.infer<typeof BlackjackBetSchema>;

export const BlackjackRoomActionSchema = z.object({ roomId: z.string().uuid() });
export type BlackjackRoomActionPayload = z.infer<typeof BlackjackRoomActionSchema>;


export const PokerPhaseSchema = z.enum(['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'HAND_COMPLETE']);
export type PokerPhase = z.infer<typeof PokerPhaseSchema>;

export const PokerActionSchema = z.enum(['CHECK', 'CALL', 'BET', 'RAISE', 'FOLD', 'ALL_IN', 'NEXT_HAND']);
export type PokerAction = z.infer<typeof PokerActionSchema>;

export const PokerHandCategorySchema = z.enum([
  'HIGH_CARD',
  'PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
]);
export type PokerHandCategory = z.infer<typeof PokerHandCategorySchema>;

export const PokerPotViewSchema = z.object({
  amount: z.number().int().nonnegative(),
  eligiblePlayerIds: z.array(z.string().uuid()),
});
export type PokerPotView = z.infer<typeof PokerPotViewSchema>;

export const PokerPlayerViewSchema = z.object({
  playerId: z.string().uuid(),
  displayName: z.string(),
  seat: z.number().int().nonnegative(),
  stack: z.number().int().nonnegative(),
  streetBet: z.number().int().nonnegative(),
  contributed: z.number().int().nonnegative(),
  folded: z.boolean(),
  allIn: z.boolean(),
  connected: z.boolean(),
  cards: z.tuple([CardViewSchema.nullable(), CardViewSchema.nullable()]),
  handCategory: PokerHandCategorySchema.nullable(),
  won: z.number().int().nonnegative(),
});
export type PokerPlayerView = z.infer<typeof PokerPlayerViewSchema>;

export const PokerStateViewSchema = z.object({
  roomId: z.string().uuid(),
  hand: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  phase: PokerPhaseSchema,
  dealerPlayerId: z.string().uuid(),
  smallBlind: z.number().int().positive(),
  bigBlind: z.number().int().positive(),
  currentBet: z.number().int().nonnegative(),
  minimumRaiseTo: z.number().int().positive(),
  currentPlayerId: z.string().uuid().nullable(),
  turnDeadline: z.string().datetime().nullable(),
  board: z.array(CardViewSchema).max(5),
  pots: z.array(PokerPotViewSchema),
  players: z.array(PokerPlayerViewSchema),
  allowedActions: z.array(PokerActionSchema),
  callAmount: z.number().int().nonnegative(),
});
export type PokerStateView = z.infer<typeof PokerStateViewSchema>;

export const PokerRoomActionSchema = z.object({ roomId: z.string().uuid() });
export type PokerRoomActionPayload = z.infer<typeof PokerRoomActionSchema>;

export const PokerAmountActionSchema = z.object({
  roomId: z.string().uuid(),
  amount: z.number().int().positive(),
});
export type PokerAmountActionPayload = z.infer<typeof PokerAmountActionSchema>;

export const ServerErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'VALIDATION_ERROR',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_ALREADY_STARTED',
  'INSUFFICIENT_PLAYERS',
  'NOT_ROOM_MEMBER',
  'NOT_ROOM_HOST',
  'WRONG_GAME_TYPE',
  'GAME_NOT_FOUND',
  'NOT_YOUR_TURN',
  'INVALID_ACTION',
  'INVALID_BET',
  'INSUFFICIENT_CHIPS',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);
export type ServerErrorCode = z.infer<typeof ServerErrorCodeSchema>;

export const ServerErrorSchema = z.object({
  code: ServerErrorCodeSchema,
  message: z.string(),
});
export type ServerError = z.infer<typeof ServerErrorSchema>;

export type CommandAck = { ok: true } | { ok: false; error: ServerError };
export type RoomLeaveAck = CommandAck;

export interface ClientToServerEvents {
  'room:subscribe': (payload: RoomSubscribePayload) => void;
  'room:leave': (payload: RoomLeavePayload, callback: (response: RoomLeaveAck) => void) => void;
  'game:start': (payload: GameStartPayload, callback: (response: CommandAck) => void) => void;
  'blackjack:bet': (payload: BlackjackBetPayload, callback: (response: CommandAck) => void) => void;
  'blackjack:hit': (payload: BlackjackRoomActionPayload, callback: (response: CommandAck) => void) => void;
  'blackjack:stand': (payload: BlackjackRoomActionPayload, callback: (response: CommandAck) => void) => void;
  'blackjack:double': (payload: BlackjackRoomActionPayload, callback: (response: CommandAck) => void) => void;
  'blackjack:nextRound': (payload: BlackjackRoomActionPayload, callback: (response: CommandAck) => void) => void;
  'poker:check': (payload: PokerRoomActionPayload, callback: (response: CommandAck) => void) => void;
  'poker:call': (payload: PokerRoomActionPayload, callback: (response: CommandAck) => void) => void;
  'poker:bet': (payload: PokerAmountActionPayload, callback: (response: CommandAck) => void) => void;
  'poker:raise': (payload: PokerAmountActionPayload, callback: (response: CommandAck) => void) => void;
  'poker:fold': (payload: PokerRoomActionPayload, callback: (response: CommandAck) => void) => void;
  'poker:allIn': (payload: PokerRoomActionPayload, callback: (response: CommandAck) => void) => void;
  'poker:nextHand': (payload: PokerRoomActionPayload, callback: (response: CommandAck) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'room:playerJoined': (room: RoomView) => void;
  'room:playerLeft': (room: RoomView) => void;
  'room:hostChanged': (room: RoomView) => void;
  'blackjack:state': (state: BlackjackStateView) => void;
  'poker:state': (state: PokerStateView) => void;
  'server:error': (error: ServerError) => void;
}
