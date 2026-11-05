import * as mediasoupClient from 'mediasoup-client';
import type { Socket } from 'socket.io-client';
import { emitAck } from './socket';

type VoiceSession = {
  device: mediasoupClient.types.Device;
  sendTransport: mediasoupClient.types.Transport;
  recvTransport: mediasoupClient.types.Transport;
  producer: mediasoupClient.types.Producer | null;
  consumers: Map<string, mediasoupClient.types.Consumer>;
  audioEls: Map<string, HTMLAudioElement>;
  localStream: MediaStream | null;
  channelId: number;
  muted: boolean;
};

let session: VoiceSession | null = null;

async function requestMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

async function createTransport(socket: Socket, channelId: number, device: mediasoupClient.types.Device, direction: 'send' | 'recv') {
  const res = await emitAck<{ transport?: mediasoupClient.types.TransportOptions; error?: string }>(
    socket,
    'voice:createTransport',
    { channelId },
  );
  if (res.error || !res.transport) throw new Error(res.error || 'create transport failed');

  const transport =
    direction === 'send'
      ? device.createSendTransport(res.transport)
      : device.createRecvTransport(res.transport);

  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    emitAck(socket, 'voice:connectTransport', {
      channelId,
      transportId: transport.id,
      dtlsParameters,
    })
      .then(() => callback())
      .catch(errback);
  });

  if (direction === 'send') {
    transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      emitAck<{ id?: string; error?: string }>(socket, 'voice:produce', {
        channelId,
        transportId: transport.id,
        kind,
        rtpParameters,
      })
        .then((r) => {
          if (r.error || !r.id) throw new Error(r.error || 'produce failed');
          callback({ id: r.id });
        })
        .catch(errback);
    });
  }

  return transport;
}

export async function startVoice(socket: Socket, channelId: number) {
  await stopVoice(socket);

  const caps = await emitAck<{ rtpCapabilities?: mediasoupClient.types.RtpCapabilities; error?: string }>(
    socket,
    'voice:getRouterRtpCapabilities',
    { channelId },
  );
  if (caps.error || !caps.rtpCapabilities) throw new Error(caps.error || 'no rtp capabilities');

  const device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: caps.rtpCapabilities });

  const sendTransport = await createTransport(socket, channelId, device, 'send');
  const recvTransport = await createTransport(socket, channelId, device, 'recv');

  session = {
    device,
    sendTransport,
    recvTransport,
    producer: null,
    consumers: new Map(),
    audioEls: new Map(),
    localStream: null,
    channelId,
    muted: false,
  };

  const join = await emitAck<{
    ok?: boolean;
    producers?: { userId: number; producerId: string }[];
    error?: string;
  }>(socket, 'voice:join', { channelId });
  if (join.error) throw new Error(join.error);

  const localStream = await requestMic();
  const track = localStream.getAudioTracks()[0];
  const producer = await sendTransport.produce({ track });
  session.localStream = localStream;
  session.producer = producer;

  for (const p of join.producers || []) {
    await consumeProducer(socket, p.producerId);
  }

  return session;
}

export async function consumeProducer(socket: Socket, producerId: string) {
  if (!session) return;
  if ([...session.consumers.values()].some((c) => c.producerId === producerId)) return;

  const res = await emitAck<{
    consumer?: {
      id: string;
      producerId: string;
      kind: 'audio' | 'video';
      rtpParameters: mediasoupClient.types.RtpParameters;
    };
    error?: string;
  }>(socket, 'voice:consume', {
    channelId: session.channelId,
    transportId: session.recvTransport.id,
    producerId,
    rtpCapabilities: session.device.rtpCapabilities,
  });
  if (res.error || !res.consumer) {
    console.error('consume failed', res.error);
    return;
  }

  const consumer = await session.recvTransport.consume({
    id: res.consumer.id,
    producerId: res.consumer.producerId,
    kind: res.consumer.kind,
    rtpParameters: res.consumer.rtpParameters,
  });
  session.consumers.set(consumer.id, consumer);

  const stream = new MediaStream([consumer.track]);
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.srcObject = stream;
  document.body.appendChild(audio);
  session.audioEls.set(consumer.id, audio);
  try {
    await audio.play();
  } catch (err) {
    console.warn('audio play blocked', err);
  }
}

export function setMuted(muted: boolean) {
  if (!session?.producer) return;
  if (muted) session.producer.pause();
  else session.producer.resume();
  session.muted = muted;
  if (session.localStream) {
    for (const track of session.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }
}

export function isMuted() {
  return session?.muted ?? false;
}

export function getActiveVoiceChannelId() {
  return session?.channelId ?? null;
}

export async function stopVoice(socket?: Socket) {
  if (!session) return;
  const channelId = session.channelId;
  for (const audio of session.audioEls.values()) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
  }
  for (const consumer of session.consumers.values()) consumer.close();
  session.producer?.close();
  session.sendTransport.close();
  session.recvTransport.close();
  session.localStream?.getTracks().forEach((t) => t.stop());
  session = null;
  if (socket) {
    try {
      await emitAck(socket, 'voice:leave', {});
    } catch {
      // ignore
    }
  }
  return channelId;
}
