export type JsonRecord = Record<string, unknown>;

export type SocketTokenQueryData = {
  query?: {
    token?: string;
  };
};

export type SocketDataCarrier = {
  data: unknown;
};

export type SocketJsonSender = {
  send: (payload: string) => void;
};
