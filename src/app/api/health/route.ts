export type HealthResponse = {
  status: "ok";
  timestamp: string;
};

export async function GET(): Promise<Response> {
  const body: HealthResponse = {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
  return Response.json(body);
}
