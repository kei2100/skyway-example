import {MutableRefObject, useCallback, useEffect, useMemo, useState} from "react";
import {
  LocalP2PRoomMember,
  LocalVideoStream,
  P2PRoom,
  RemoteAudioStream,
  RemoteVideoStream, RoomPublication,
  SkyWayContext,
  SkyWayRoom,
  SkyWayStreamFactory
} from "@skyway-sdk/room";

export const useP2PHost = (
  localVideoRef: MutableRefObject<HTMLVideoElement>,
  remoteVideoRef: MutableRefObject<HTMLVideoElement>,
) => {
  const [room, setRoom] = useState<P2PRoom | null>(null);
  const [localMember, setLocalMember] = useState<LocalP2PRoomMember | null>(null);
  const [isLocalMemberJoining, setIsLocalMemberJoining] = useState(false);
  const [isRemoteMemberJoining, setIsRemoteMemberJoining] = useState(false);
  const [isInConversation, setIsInConversation] = useState(false);

  /**
   * ルームへの入退室
   * */
  // 入室
  const joinSession = useCallback(async (roomId: string, token: string) => {
    if (isLocalMemberJoining) {
      return;
    }
    const context = await SkyWayContext.Create(token);
    const room = await SkyWayRoom.FindOrCreate(context, {
      type: "p2p",
      name: roomId,
    });
    setRoom(room);
    const me = await room.join({ name: "host" });
    setLocalMember(me);
    setIsLocalMemberJoining(true);
  }, [isLocalMemberJoining]);

  // 退室
  const leaveSession = useCallback(async () => {
    if (!localMember || !isLocalMemberJoining) {
      return;
    }
    await localMember.leave();
    setLocalMember(null);
    setIsLocalMemberJoining(false);
    setIsInConversation(false);
    await room.dispose();
  }, [localMember, isLocalMemberJoining, room]);

  // リモートメンバーの入退室
  useEffect(() => {
    if (!room) {
      return;
    }
    room.members.forEach(member => {
      if (member.name !== "host") {
        setIsRemoteMemberJoining(true);
      }
    });
    room.onMemberJoined.add(ev => {
      if (ev.member.name !== "host") {
        setIsRemoteMemberJoining(true);
      }
    });
    room.onMemberLeft.add(ev => {
      if (ev.member.name !== "host") {
        setIsRemoteMemberJoining(false);
        setIsInConversation(false);
      }
    });
  }, [room]);

  /**
   * 通話開始
   * */
  const startConversation = useCallback(async () => {
    if (!room) {
      return;
    }
    // リモートメンバーに自分の音声・映像を subscribe させる
    const remoteMember = room.members.find(m => m.name !== "host")
    if (!remoteMember) {
      return;
    }
    room.publications.forEach(pub => {
      if (pub.publisher.name !== "host") {
        return;
      }
      remoteMember.subscribe(pub.id);
    })
    setIsInConversation(true);
  }, [room]);

  /**
   * 映像・音声ストリームの取得関連処理
   * */
  const [localVideoStream, setLocalVideoStream] = useState<LocalVideoStream | null>(null);
  const [remoteAudioStream, setRemoteAudioStream] = useState<RemoteAudioStream | null>(null);
  const [remoteVideoStream, setRemoteVideoStream] = useState<RemoteVideoStream | null>(null);

  useEffect(() => {
    if (!room || !localMember) {
      return;
    }
    // ローカルの映像音声
    (async () => {
      const { audio, video } = await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream();
      await localMember.publish(audio);
      await localMember.publish(video);
      setLocalVideoStream(video);
    })();
    // リモートの映像音声
    const handlePublication = (pub: RoomPublication) => {
      if (pub.publisher.name === "host") {
        return;
      }
      localMember.subscribe(pub.id).then(({ stream }) => {
        switch (stream.constructor) {
          case RemoteAudioStream:
            stream = stream as RemoteAudioStream;
            setRemoteAudioStream(stream);
            break;
          case RemoteVideoStream:
            stream = stream as RemoteVideoStream;
            setRemoteVideoStream(stream);
            break;
        }
      });
    }
    room.publications.forEach(handlePublication);
    room.onStreamPublished.add(e => {
      handlePublication(e.publication);
    })
  }, [room, localMember]);

  /**
   * ビデオ通話ストリームの HTMLVideoElement へのアタッチ・デタッチ
   * */
  useEffect(() => {
    (async () => {
      if (!isLocalMemberJoining) {
        localVideoStream?.detach();
        localVideoStream?.release()
        remoteVideoStream?.detach();
        remoteAudioStream?.detach();
      } else {
        if (localVideoStream) {
          localVideoStream.attach(localVideoRef.current);
          await localVideoRef.current.play();
        }
      }
      if (!isRemoteMemberJoining) {
        remoteVideoStream?.detach();
        remoteAudioStream?.detach();
      } else {
        if (remoteVideoStream) {
          remoteVideoStream.attach(remoteVideoRef.current);
          await remoteVideoRef.current.play();
        }
        if (isInConversation && remoteAudioStream) {
          remoteAudioStream.attach(remoteVideoRef.current);
          await remoteVideoRef.current.play();
        }
      }
    })();
  }, [
    isLocalMemberJoining,
    isRemoteMemberJoining,
    isRemoteMemberJoining,
    isInConversation,
    localVideoStream,
    remoteVideoStream,
    remoteAudioStream,
  ]);

  return {
    isLocalMemberJoining,
    isRemoteMemberJoining,
    isInConversation,
    joinSession,
    leaveSession,
    startConversation,
  };
}