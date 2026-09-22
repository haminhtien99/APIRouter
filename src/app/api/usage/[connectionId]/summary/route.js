import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { GET as getRawUsage } from "../route.js";
import {
  getRemainingPercentage,
  parseQuotaData,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils";

export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const { connectionId } = await context.params;
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const response = await getRawUsage(request, context);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  const quotas = parseQuotaData(connection.provider, data).map((quota) => ({
    ...quota,
    remainingPercentage: getRemainingPercentage(quota),
  }));

  return NextResponse.json({
    connection: {
      id: connection.id,
      provider: connection.provider,
      name: connection.name || connection.email || connection.displayName || connection.id.slice(0, 8),
      email: connection.email || null,
      isActive: connection.isActive !== false,
    },
    plan: data.plan || null,
    message: data.message || null,
    quotas,
  });
}
