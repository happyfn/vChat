import os from 'node:os';
import * as mediasoup from 'mediasoup';
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  DtlsParameters,
  RtpCapabilities,
  RtpParameters,
  RtpCodecCapability,
} from 'mediasoup/types';

const mediaCodecs: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    preferredPayloadType: 111,
  },
];

type PeerState = {
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
};

type RoomState = {
  router: Router;
  peers: Map<number, PeerState>;
};

let worker: Worker;
const rooms = new Map<number, RoomState>();

function getListenIp() {
  return process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
}

function getAnnouncedIp() {
  if (process.env.MEDIASOUP_ANNOUNCED_IP) return process.env.MEDIASOUP_ANNOUNCED_IP;
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

export async function initVoice() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT) || 40000,
    rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 40100,
  });
  worker.on('died', () => {
    console.error('mediasoup worker died, exiting');
    process.exit(1);
  });
  console.log(`mediasoup worker started, announcedIp=${getAnnouncedIp()}`);
}

async function getOrCreateRoom(channelId: number): Promise<RoomState> {
  let room = rooms.get(channelId);
  if (room) return room;
  const router = await worker.createRouter({ mediaCodecs });
  room = { router, peers: new Map() };
  rooms.set(channelId, room);
  return room;
}

function getPeer(room: RoomState, userId: number): PeerState {
  let peer = room.peers.get(userId);
  if (!peer) {
    peer = { transports: new Map(), producers: new Map(), consumers: new Map() };
    room.peers.set(userId, peer);
  }
  return peer;
}

export async function getRouterRtpCapabilities(channelId: number): Promise<RtpCapabilities> {
  const room = await getOrCreateRoom(channelId);
  return room.router.rtpCapabilities;
}

export async function createWebRtcTransport(channelId: number, userId: number) {
  const room = await getOrCreateRoom(channelId);
  const peer = getPeer(room, userId);
  const transport = await room.router.createWebRtcTransport({
    listenIps: [{ ip: getListenIp(), announcedIp: getAnnouncedIp() }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  peer.transports.set(transport.id, transport);
  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') transport.close();
  });
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

export async function connectTransport(
  channelId: number,
  userId: number,
  transportId: string,
  dtlsParameters: DtlsParameters,
) {
  const room = rooms.get(channelId);
  const transport = room?.peers.get(userId)?.transports.get(transportId);
  if (!transport) throw new Error('transport not found');
  await transport.connect({ dtlsParameters });
}

export async function produce(
  channelId: number,
  userId: number,
  transportId: string,
  kind: 'audio' | 'video',
  rtpParameters: RtpParameters,
) {
  const room = rooms.get(channelId);
  const peer = room?.peers.get(userId);
  const transport = peer?.transports.get(transportId);
  if (!room || !peer || !transport) throw new Error('transport not found');
  const producer = await transport.produce({ kind, rtpParameters });
  peer.producers.set(producer.id, producer);
  producer.on('transportclose', () => {
    peer.producers.delete(producer.id);
  });
  return { id: producer.id };
}

export async function consumeOnTransport(
  channelId: number,
  userId: number,
  transportId: string,
  producerId: string,
  rtpCapabilities: RtpCapabilities,
) {
  const room = rooms.get(channelId);
  const peer = room?.peers.get(userId);
  const transport = peer?.transports.get(transportId);
  if (!room || !peer || !transport) throw new Error('transport not found');
  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('cannot consume');
  }
  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: false,
  });
  peer.consumers.set(consumer.id, consumer);
  consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
  return {
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

export function listProducers(channelId: number, exceptUserId?: number) {
  const room = rooms.get(channelId);
  if (!room) return [] as { userId: number; producerId: string }[];
  const result: { userId: number; producerId: string }[] = [];
  for (const [uid, peer] of room.peers) {
    if (exceptUserId !== undefined && uid === exceptUserId) continue;
    for (const producer of peer.producers.values()) {
      result.push({ userId: uid, producerId: producer.id });
    }
  }
  return result;
}

export function leaveVoice(channelId: number, userId: number) {
  const room = rooms.get(channelId);
  if (!room) return;
  const peer = room.peers.get(userId);
  if (!peer) return;
  for (const consumer of peer.consumers.values()) consumer.close();
  for (const producer of peer.producers.values()) producer.close();
  for (const transport of peer.transports.values()) transport.close();
  room.peers.delete(userId);
  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(channelId);
  }
}

export function closeAllForUser(userId: number) {
  for (const channelId of [...rooms.keys()]) {
    leaveVoice(channelId, userId);
  }
}
