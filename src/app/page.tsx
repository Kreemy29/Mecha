"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Plus,
  Loader2,
} from "lucide-react";

interface Job {
  id: number;
  kind: string;
  status: string;
  provider: string | null;
  providerModel: string | null;
  prompt: string | null;
  attempts: number;
  error: string | null;
  outputPath: string | null;
  costEstimate: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  statusCounts: Array<{ status: string; count: number }>;
  providerCounts: Array<{
    provider: string;
    status: string;
    count: number;
  }>;
  totalCost: number;
  dailyCostCap: number;
}

const statusConfig: Record<
  string,
  { color: string; dot: string }
> = {
  queued: {
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dot: "bg-amber-400",
  },
  running: {
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dot: "bg-blue-400 animate-pulse",
  },
  polling: {
    color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    dot: "bg-cyan-400 animate-pulse",
  },
  succeeded: {
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dot: "bg-emerald-400",
  },
  failed: {
    color: "bg-red-500/10 text-red-400 border-red-500/20",
    dot: "bg-red-400",
  },
  filtered: {
    color: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    dot: "bg-orange-400",
  },
  rejected: {
    color: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    dot: "bg-violet-400",
  },
};

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [jobsRes, statsRes] = await Promise.all([
        fetch("/api/jobs?limit=50"),
        fetch("/api/stats"),
      ]);
      setJobs(await jobsRes.json());
      setStats(await statsRes.json());
    } catch {
      // silent fail on poll
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const eventSource = new EventSource("/api/jobs/sse");
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "jobs") {
          setJobs(parsed.data);
        }
      } catch {
        // ignore
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    const statsInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/stats");
        setStats(await res.json());
      } catch {
        // silent
      }
    }, 5000);

    return () => {
      eventSource.close();
      clearInterval(statsInterval);
    };
  }, [fetchData]);

  const createTestJob = async () => {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          prompt: `Test image generation prompt #${Date.now()}`,
          provider: "dummy",
        }),
      });
      if (res.ok) {
        toast.success("Test job created");
        fetchData();
      }
    } catch {
      toast.error("Failed to create test job");
    }
  };

  const getStatusCount = (status: string) =>
    stats?.statusCounts.find((s) => s.status === status)?.count || 0;

  const activeJobs =
    getStatusCount("running") +
    getStatusCount("polling") +
    getStatusCount("queued");
  const costPercent = stats
    ? Math.min((stats.totalCost / stats.dailyCostCap) * 100, 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            Dashboard
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Live job status and system overview
          </p>
        </div>
        <Button
          onClick={createTestJob}
          size="sm"
          className="glass-strong border-white/10 bg-[oklch(0.75_0.15_270_/_10%)] hover:bg-[oklch(0.75_0.15_270_/_20%)] text-foreground gap-2 rounded-xl"
        >
          <Plus className="h-4 w-4" />
          Create Test Job
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="group">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Active Jobs
              </CardTitle>
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Activity className="h-4 w-4 text-blue-400" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-20 bg-white/5" />
            ) : (
              <div className="text-3xl font-bold tracking-tight">
                {activeJobs}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="group">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Completed
              </CardTitle>
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-20 bg-white/5" />
            ) : (
              <div className="text-3xl font-bold tracking-tight text-emerald-400">
                {getStatusCount("succeeded")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="group">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Failed / Filtered
              </CardTitle>
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-20 bg-white/5" />
            ) : (
              <div className="text-3xl font-bold tracking-tight text-red-400">
                {getStatusCount("failed") + getStatusCount("filtered")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="group">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Cost Today
              </CardTitle>
              <div className="p-2 rounded-lg bg-violet-500/10">
                <DollarSign className="h-4 w-4 text-violet-400" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-28 bg-white/5" />
            ) : (
              <div className="space-y-3">
                <div className="text-3xl font-bold tracking-tight">
                  ${stats?.totalCost.toFixed(2) || "0.00"}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    / ${stats?.dailyCostCap || 50}
                  </span>
                </div>
                <div className="relative h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-500"
                    style={{ width: `${costPercent}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Job Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Recent Jobs
            </CardTitle>
            {!loading && jobs.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {jobs.length} jobs
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg bg-white/5" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-2xl glass mb-4">
                <Loader2 className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No jobs yet. Create a test job to verify the worker.
              </p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border border-white/5">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead className="w-16 text-xs font-medium uppercase tracking-wider">
                      ID
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">
                      Kind
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">
                      Status
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">
                      Provider
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider max-w-[300px]">
                      Prompt
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">
                      Tries
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">
                      Error
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => {
                    const sc = statusConfig[job.status] || {
                      color: "",
                      dot: "bg-gray-400",
                    };
                    return (
                      <TableRow
                        key={job.id}
                        className="border-white/5"
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          #{job.id}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-xs border-white/10 bg-white/5"
                          >
                            {job.kind}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-xs border gap-1.5 ${sc.color}`}
                          >
                            <span
                              className={`inline-block h-1.5 w-1.5 rounded-full ${sc.dot}`}
                            />
                            {job.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {job.provider || "-"}
                          {job.providerModel && (
                            <span className="block text-[10px] text-muted-foreground/60">
                              {job.providerModel}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className="max-w-[300px] truncate text-xs"
                          title={job.prompt || ""}
                        >
                          {job.prompt || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-center">
                          {job.attempts}
                        </TableCell>
                        <TableCell
                          className="max-w-[200px] truncate text-xs text-red-400/80"
                          title={job.error || ""}
                        >
                          {job.error || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(job.createdAt).toLocaleTimeString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
