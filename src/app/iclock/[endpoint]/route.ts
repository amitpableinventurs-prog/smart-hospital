import { connection } from "next/server";
import { clientIp } from "@/lib/api";
import { deviceCheckIn, deviceOptions, receiveAttlog } from "@/lib/biometric";
import { connectDB } from "@/lib/db";

/**
 * ZKTeco / eSSL "ADMS" push protocol used by biometric attendance machines
 * (Menu → Comm → Cloud Server Setting → this server's address and port).
 *   GET  /iclock/cdata?SN=…            handshake: upload options
 *   POST /iclock/cdata?SN=…&table=ATTLOG&Stamp=…   punches
 *   GET  /iclock/getrequest?SN=…       command poll (none are sent)
 *   POST /iclock/devicecmd?SN=…        command results
 * Machines have no login: only serial numbers approved in HR → Biometric
 * Attendance are accepted. Others are listed there as Pending and keep their
 * punches until approved.
 */

type Ctx = { params: Promise<{ endpoint: string }> };

const MAX_BODY = 5_000_000;

const reply = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

async function serve(req: Request, { params }: Ctx) {
  await connection();
  const endpoint = (await params).endpoint.toLowerCase().replace(/\.aspx$/, "");
  if (!["cdata", "getrequest", "devicecmd", "ping"].includes(endpoint)) return reply("Not found", 404);
  const url = new URL(req.url);
  const serialNo = (url.searchParams.get("SN") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,40}$/.test(serialNo)) return reply("ERROR: SN required", 400);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return reply("ERROR: too large", 413);

  try {
    await connectDB();
    const device = await deviceCheckIn(serialNo, clientIp(req));
    if (!device || device.status !== "Active") return reply("ERROR: device not approved", 403);

    if (endpoint === "cdata" && req.method === "GET") return reply(deviceOptions(device));
    if (endpoint === "cdata" && req.method === "POST") {
      const body = await req.text();
      if (body.length > MAX_BODY) return reply("ERROR: too large", 413);
      // Only attendance logs are used; operation logs, photos and user data are acknowledged and dropped.
      if ((url.searchParams.get("table") ?? "").toUpperCase() !== "ATTLOG") return reply("OK");
      return reply(`OK: ${await receiveAttlog(device, body, url.searchParams.get("Stamp"))}`);
    }
    return reply("OK");
  } catch (err) {
    console.error(`[iclock] ${serialNo} ${endpoint} failed:`, err);
    // The machine keeps the punches and retries after ErrorDelay.
    return reply("ERROR", 500);
  }
}

export const GET = serve;
export const POST = serve;
