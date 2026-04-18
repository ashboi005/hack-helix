export type MiddlewareErrorResponse = {
  error: {
    message: string;
  };
};

export type EmailRequestBody = {
  email?: string;
};

export type UserIdLookupResult = {
  id: string;
};
