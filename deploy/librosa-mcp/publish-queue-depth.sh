#!/usr/bin/env bash
# Publish analysis queue depth to CloudWatch so an Auto Scaling group can react.
#
# The metric is the same signal the admin health panel shows: how many rows in
# public.analysis_jobs are pending or processing. Target-tracking on
# PendingJobsPerWorker keeps worker count proportional to backlog.
#
# Install on any host with AWS creds (the worker box is fine):
#   sudo cp publish-queue-depth.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/publish-queue-depth.sh
#   # /etc/librosa-queue.env:
#   #   SUPABASE_URL=https://<project>.supabase.co
#   #   SUPABASE_SERVICE_ROLE_KEY=<service role key>   # never commit this
#   #   AWS_REGION=us-east-1
#   #   ASG_NAME=librosa-workers
#   * * * * * . /etc/librosa-queue.env && /usr/local/bin/publish-queue-depth.sh
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL not set}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"
: "${AWS_REGION:=us-east-1}"
: "${ASG_NAME:=librosa-workers}"
: "${NAMESPACE:=SonicSIM/Analysis}"

count_jobs() {
  local status_filter="$1"
  curl -sS --fail-with-body --max-time 15 \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: count=exact" \
    -H "Range: 0-0" \
    -D - -o /dev/null \
    "${SUPABASE_URL}/rest/v1/analysis_jobs?select=id&status=${status_filter}" \
    | tr -d '\r' | awk -F'/' '/^content-range:/ { print $2 }'
}

pending=$(count_jobs "eq.pending")
processing=$(count_jobs "eq.processing")
pending=${pending:-0}
processing=${processing:-0}
backlog=$(( pending + processing ))

desired=$(aws autoscaling describe-auto-scaling-groups \
  --region "$AWS_REGION" \
  --auto-scaling-group-names "$ASG_NAME" \
  --query 'AutoScalingGroups[0].DesiredCapacity' --output text 2>/dev/null || echo 1)
[ "$desired" = "None" ] && desired=1
[ "${desired:-0}" -lt 1 ] && desired=1

per_worker=$(awk -v b="$backlog" -v d="$desired" 'BEGIN { printf "%.2f", b / d }')

aws cloudwatch put-metric-data \
  --region "$AWS_REGION" \
  --namespace "$NAMESPACE" \
  --metric-data \
    "MetricName=PendingJobs,Unit=Count,Value=${pending},Dimensions=[{Name=AutoScalingGroupName,Value=${ASG_NAME}}]" \
    "MetricName=Backlog,Unit=Count,Value=${backlog},Dimensions=[{Name=AutoScalingGroupName,Value=${ASG_NAME}}]" \
    "MetricName=PendingJobsPerWorker,Unit=Count,Value=${per_worker},Dimensions=[{Name=AutoScalingGroupName,Value=${ASG_NAME}}]"

echo "pending=${pending} processing=${processing} backlog=${backlog} desired=${desired} per_worker=${per_worker}"
