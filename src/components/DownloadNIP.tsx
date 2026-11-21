import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
// The project's protocol document, bundled at build time so the download never drifts from it
import nipContent from "../../NIP.md?raw";

export function DownloadNIP() {
  const handleDownload = () => {
    const blob = new Blob([nipContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'village-vibe-nip.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking synchronously can cancel the download in some browsers
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Button onClick={handleDownload} variant="outline" className="gap-2">
      <Download className="h-4 w-4" />
      Download NIP Document
    </Button>
  );
}
