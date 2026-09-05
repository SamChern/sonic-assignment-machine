import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  User,
  Radio,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { SignalCohortPanel } from "@/components/SignalCohortPanel";
import type { EntityMode, UserProfile, AudioSourceWithProfile } from "./types";
import { providerMeta } from "./types";

interface Neighbor {
  fp: { user_id: string; avatar_url?: string | null; username?: string | null };
  similarity: number;
}

interface UsersSourcesTabProps {
  entityMode: EntityMode;
  // signal mode
  signalPoints: any[];
  cohorts: any[];
  meta: any;
  cohortCount: number;
  onCohortCountChange: (k: number) => void;
  selectedCohortKeys: string[];
  toggleCohortFilter: (key: string) => void;
  signalsLoading: boolean;
  // user mode
  userQuery: string;
  setUserQuery: (v: string) => void;
  userSort: "name_asc" | "name_desc" | "sources_desc" | "sources_asc";
  setUserSort: (v: "name_asc" | "name_desc" | "sources_desc" | "sources_asc") => void;
  listedUsers: UserProfile[];
  displayedUsers: UserProfile[];
  filteredUserIds: string[];
  getSourcesByUser: (userId: string) => AudioSourceWithProfile[];
  selectedSourceIds: string[];
  selectedUserIds: string[];
  expandedGroups: string[];
  toggleGroup: (key: string) => void;
  selectAllUserSources: (userId: string) => void;
  toggleUserSelection: (userId: string) => void;
  allFingerprints: any[];
  neighborsOpenFor: string | null;
  setNeighborsOpenFor: (id: string | null) => void;
  getTopNeighbors: (userId: string, limit?: number) => Neighbor[];
  renderSourceRow: (source: AudioSourceWithProfile, showOwner?: boolean) => ReactNode;
  // provider mode
  displayedProviders: string[];
  filteredProviders: string[];
  getSourcesByProvider: (provider: string) => AudioSourceWithProfile[];
  signalCounts: Record<string, number>;
  selectAllProviderSources: (provider: string) => void;
}

/** The "Users & Sources" tab — behaviour varies per entity mode (user/provider/signal). */
export function UsersSourcesTab({
  entityMode,
  signalPoints,
  cohorts,
  meta,
  cohortCount,
  onCohortCountChange,
  selectedCohortKeys,
  toggleCohortFilter,
  signalsLoading,
  userQuery,
  setUserQuery,
  userSort,
  setUserSort,
  listedUsers,
  displayedUsers,
  filteredUserIds,
  getSourcesByUser,
  selectedSourceIds,
  expandedGroups,
  toggleGroup,
  selectAllUserSources,
  toggleUserSelection,
  selectedUserIds,
  allFingerprints,
  neighborsOpenFor,
  setNeighborsOpenFor,
  getTopNeighbors,
  renderSourceRow,
  displayedProviders,
  filteredProviders,
  getSourcesByProvider,
  signalCounts,
  selectAllProviderSources,
}: UsersSourcesTabProps) {
  if (entityMode === "signal") {
    return (
      <div className="space-y-4">
        <SignalCohortPanel
          points={signalPoints}
          cohorts={cohorts}
          meta={meta}
          cohortCount={cohortCount}
          onCohortCountChange={onCohortCountChange}
          selectedCohortKeys={selectedCohortKeys}
          onToggleCohort={toggleCohortFilter}
          loading={signalsLoading}
        />
      </div>
    );
  }

  if (entityMode === "user") {
    return (
      <div className="space-y-3">
        {/* Streamlined list toolbar: search + sort */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Search users by name or bio…"
              className="pl-9"
              aria-label="Search users"
            />
          </div>
          <Select value={userSort} onValueChange={(v) => setUserSort(v as typeof userSort)}>
            <SelectTrigger className="w-full gap-2 sm:w-56" aria-label="Sort users">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Name A–Z</SelectItem>
              <SelectItem value="name_desc">Name Z–A</SelectItem>
              <SelectItem value="sources_desc">Most sources</SelectItem>
              <SelectItem value="sources_asc">Fewest sources</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {listedUsers.length} of {displayedUsers.length} user{displayedUsers.length !== 1 ? 's' : ''}
        </p>

        {listedUsers.length === 0 ? (
          <Card className="p-8 text-center">
            <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg text-muted-foreground">
              {userQuery
                ? `No users match "${userQuery}"`
                : filteredUserIds.length > 0
                  ? 'No users match your filter'
                  : 'No users yet'}
            </p>
            {userQuery && (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setUserQuery("")}>
                Clear search
              </Button>
            )}
          </Card>
        ) : (
        <Card className="divide-y divide-border/60 overflow-hidden bg-card/80">
        {listedUsers.map(userProfile => {
          const userSources = getSourcesByUser(userProfile.user_id);
          const allSelected = userSources.length > 0 &&
            userSources.every(s => selectedSourceIds.includes(s.id));
          const groupKey = `user:${userProfile.user_id}`;
          const isExpanded = expandedGroups.includes(groupKey);

          const fp = allFingerprints.find(f => f.user_id === userProfile.user_id);

          return (
            <div key={userProfile.id} className="px-4 py-3 transition-colors hover:bg-muted/40">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex min-w-0 items-center gap-3">
                  <Checkbox
                    checked={selectedUserIds.includes(userProfile.user_id)}
                    onCheckedChange={() => toggleUserSelection(userProfile.user_id)}
                    aria-label={`Select ${userProfile.username || 'Anonymous User'}`}
                  />
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={userProfile.avatar_url || undefined} />
                    <AvatarFallback>
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {userProfile.username || 'Anonymous User'}
                      </h3>
                      <Badge variant="secondary" className="shrink-0 text-[11px]">
                        {userSources.length} source{userSources.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    {userProfile.bio && (
                      <p className="truncate text-xs text-muted-foreground">{userProfile.bio}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {userSources.length > 0 && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={() => toggleGroup(groupKey)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {isExpanded ? 'Hide' : 'Show'} sources
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => selectAllUserSources(userProfile.user_id)}
                      >
                        {allSelected ? 'Deselect All' : 'Select All'}
                      </Button>
                    </>
                  )}
                </div>
              </div>


              {isExpanded && userSources.length > 0 && (
                <div className="grid gap-2 ml-8 mt-3">
                  {userSources.map(source => renderSourceRow(source))}
                </div>
              )}

              {/* Confidence + Neighbors */}
              {fp && (() => {
                const conf = Number(fp.fingerprint_confidence) || 0;
                const confLabel = conf >= 0.7 ? "High" : conf >= 0.4 ? "Medium" : "Low";
                const isOpen = neighborsOpenFor === userProfile.user_id;
                const neighbors = isOpen ? getTopNeighbors(userProfile.user_id, 3) : [];
                return (
                  <div className="ml-8 mt-2 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="gap-1 text-[11px]">
                        <ShieldCheck className="h-3 w-3" />
                        {confLabel} confidence • {fp.total_sources_analyzed} sources
                      </Badge>
                      {fp.recent_sources_analyzed > 0 && (
                        <Badge variant="outline" className="gap-1 text-[11px]">
                          <Clock className="h-3 w-3" />
                          {fp.recent_sources_analyzed} in last 30d
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setNeighborsOpenFor(isOpen ? null : userProfile.user_id)}
                      >
                        {isOpen ? "Hide" : "Show"} Taste Neighbors
                      </Button>
                    </div>
                    {isOpen && (
                      <div className="flex flex-wrap gap-2">
                        {neighbors.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No neighbors yet.</span>
                        ) : neighbors.map(n => (
                          <Badge key={n.fp.user_id} variant="outline" className="gap-1.5">
                            <Avatar className="h-4 w-4">
                              <AvatarImage src={n.fp.avatar_url || undefined} />
                              <AvatarFallback><User className="h-2 w-2" /></AvatarFallback>
                            </Avatar>
                            {n.fp.username || "Anonymous"} • {(n.similarity * 100).toFixed(0)}%
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
        </Card>
        )}
      </div>
    );
  }

  return displayedProviders.length === 0 ? (
    <Card className="p-8 text-center">
      <Radio className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      <p className="text-lg text-muted-foreground">
        {filteredProviders.length > 0 ? 'No providers match your filter' : 'No signal providers yet'}
      </p>
    </Card>
  ) : (
    <>
      {displayedProviders.map(provider => {
        const providerSources = getSourcesByProvider(provider);
        const groupKey = `provider:${provider}`;
        const isExpanded = expandedGroups.includes(groupKey);
        const allSelected = providerSources.length > 0 &&
          providerSources.every(s => selectedSourceIds.includes(s.id));
        const linkedSignals = providerSources.reduce(
          (sum, s) => sum + (signalCounts[s.id] || 0), 0
        );
        const contributors = new Set(providerSources.map(s => s.user_id)).size;
        const pMeta = providerMeta(provider);

        return (
          <Card key={provider} className="p-6 bg-card/80">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-lg gradient-primary flex items-center justify-center">
                  <Radio className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{pMeta.label}</h3>
                  <p className="text-sm text-muted-foreground">{pMeta.description}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="secondary">
                      {providerSources.length} signal{providerSources.length !== 1 ? 's' : ''}
                    </Badge>
                    <Badge variant="outline">
                      {contributors} account{contributors !== 1 ? 's' : ''}
                    </Badge>
                    {linkedSignals > 0 && (
                      <Badge variant="outline" className="gap-1">
                        <Users className="h-3 w-3" />
                        {linkedSignals} linked identifiers
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => toggleGroup(groupKey)}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {isExpanded ? 'Hide' : 'Show'} signals
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectAllProviderSources(provider)}
                >
                  {allSelected ? 'Deselect All' : 'Select All Signals'}
                </Button>
              </div>
            </div>

            {isExpanded && providerSources.length > 0 && (
              <div className="grid gap-2 ml-4 mt-4">
                {providerSources.map(source => renderSourceRow(source, true))}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
