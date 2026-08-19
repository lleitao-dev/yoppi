import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@yoppi/protocol';
import { API_URL } from './api';

export type YoppiSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): YoppiSocket {
  const options = {
    autoConnect: false,
    withCredentials: true,
  } as const;

  return API_URL ? io(API_URL, options) : io(options);
}
