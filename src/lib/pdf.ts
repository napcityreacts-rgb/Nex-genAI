import { jsPDF } from "jspdf";
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { LearningModule } from "../types";

export async function generatePDF(module: LearningModule) {
  const doc = new jsPDF();
  const margin = 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - 2 * margin;
  let y = 20;

  // Title
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(module.title, contentWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 10 + 5;

  // Summary Header
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Summary", margin, y);
  y += 10;

  // Summary Content
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  const summaryLines = doc.splitTextToSize(module.summary, contentWidth);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 7 + 10;

  // Content Header
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Detailed Content", margin, y);
  y += 10;

  // Content (Simplified markdown rendering for PDF)
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  const contentLines = doc.splitTextToSize(module.content, contentWidth);
  
  contentLines.forEach((line: string) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, margin, y);
    y += 6;
  });

  // Flashcards Header
  if (y > 250) {
    doc.addPage();
    y = 20;
  }
  y += 10;
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Flashcards", margin, y);
  y += 10;

  module.flashcards.forEach((card, index) => {
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Q${index + 1}: ${card.question}`, margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const answerLines = doc.splitTextToSize(`A: ${card.answer}`, contentWidth);
    doc.text(answerLines, margin, y);
    y += answerLines.length * 6 + 4;
  });

  // Get PDF as base64
  const pdfOutput = doc.output('datauristring').split(',')[1];

  // Save to external storage (SD card)
  const fileName = `${module.title.replace(/\s+/g, '_')}_Learning_Module.pdf`;
  try {
    await Filesystem.writeFile({
      path: `Download/${fileName}`,
      data: pdfOutput,
      directory: Directory.External,
      encoding: Encoding.UTF8,
    });
    alert(`PDF saved to SD card: ${fileName}`);
  } catch (error) {
    console.error('Error saving PDF:', error);
    // Fallback to browser download
    doc.save(fileName);
  }
}
