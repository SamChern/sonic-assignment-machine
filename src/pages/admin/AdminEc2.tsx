import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComplianceCard } from "@/components/admin/ComplianceCard";
import { Ec2StatusPanel } from "@/components/admin/Ec2StatusPanel";
import { LibrosaHealthPanel } from "@/components/LibrosaHealthPanel";

/** Infrastructure health, on its own route now that /admin is a status overview. */
const AdminEc2 = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-mobile-nav sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">EC2 &amp; inference status</h1>
            <p className="text-sm text-muted-foreground">
              Worker health, retention compliance and the librosa/embedding service.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Admin
          </Button>
        </div>
        <ComplianceCard />
        <Ec2StatusPanel />
        <LibrosaHealthPanel />
      </main>
    </div>
  );
};

export default AdminEc2;
