import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@yoppi/protocol';
import { API_URL } from './api';

export type YoppiSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): YoppiSocket {
  return io(API_URL, {
    autoConnect: false,
    withCredentials: true,
  });
}
