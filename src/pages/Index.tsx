import { useState } from "react";
import { AudioUploader } from "@/components/AudioUploader";
import { AudioPlayer } from "@/components/AudioPlayer";
import { AnalysisResults, getCategoryIcon } from "@/components/AnalysisResults";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import heroBackground from "@/assets/hero-background.jpg";

const Index = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);

  const handleAnalyze = async () => {
    if (!selectedFile) {
      toast.error("Please select an audio file first");
      return;
    }

    setIsAnalyzing(true);
    setResults(null);

    // Simulate AI analysis (will be replaced with actual backend)
    setTimeout(() => {
      const mockResults = [
        {
          name: "Emotional Expression",
          confidence: 87,
          description: "Strong indicators of human emotional patterns including tonal variation and affective prosody",
          icon: getCategoryIcon("emotional"),
        },
        {
          name: "Cognitive Patterns",
          confidence: 76,
          description: "Detected linguistic structures and reasoning patterns consistent with human thought processes",
          icon: getCategoryIcon("cognitive"),
        },
        {
          name: "Social Communication",
          confidence: 82,
          description: "Evidence of social interaction cues and conversational dynamics",
          icon: getCategoryIcon("social"),
        },
        {
          name: "Artistic Elements",
          confidence: 64,
          description: "Musical or rhythmic qualities that suggest human creative expression",
          icon: getCategoryIcon("artistic"),
        },
      ];

      setResults(mockResults);
      setIsAnalyzing(false);
      toast.success("Analysis complete!");
    }, 3000);
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="relative overflow-hidden border-b border-border">
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url(${heroBackground})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/95 to-background" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-16 sm:py-24">
          <div className="text-center space-y-6">
            <h1 className="text-5xl sm:text-6xl font-bold text-foreground">
              <span className="text-primary">[S]</span>onic{" "}
              <span className="text-primary">[A]</span>ssignment{" "}
              <span className="text-primary">[M]</span>achine
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Advanced categorical analysis to predict audio connections to human characteristics
              using AI-powered ontological classification
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-5xl px-6 py-12 space-y-8">
        {/* Upload Section */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-foreground">Upload Audio</h2>
          <AudioUploader onFileSelect={setSelectedFile} selectedFile={selectedFile} />
        </div>

        {/* Player Section */}
        {selectedFile && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-foreground">Preview</h2>
            <AudioPlayer file={selectedFile} />
            <Button
              size="lg"
              className="gradient-primary shadow-elegant w-full sm:w-auto"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              <Sparkles className="mr-2 h-5 w-5" />
              {isAnalyzing ? "Analyzing..." : "Analyze Audio"}
            </Button>
          </div>
        )}

        {/* Results Section */}
        {(results || isAnalyzing) && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-foreground">Results</h2>
            <AnalysisResults results={results} isAnalyzing={isAnalyzing} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
