import { env as sharedEnv } from "@app/env/server";
import { z } from "zod";

const gazeEnv = z
	.object({
		GAZE_BASE_URL: z.url(),
		GAZE_API_KEY: z.string().min(1),
	})
	.parse(process.env);

export const env = {
	...sharedEnv,
	...gazeEnv,
};