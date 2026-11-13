import type { Session } from "next-auth";

export type HomeUser = Session["user"];
export interface HomeProps { user: HomeUser; stockStatus?: string }
