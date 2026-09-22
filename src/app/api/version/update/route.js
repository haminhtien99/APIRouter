import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { success: false, message: "APIRouter is updated only from this local project checkout." },
    { status: 410 }
  );
}
