import React, { useState } from 'react';
import { Loader2, Copy, Check, X } from 'lucide-react';

const ClaudePromptOptimizer = () => {
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [optimizedPrompt, setOptimizedPrompt] = useState('');
  const [recommendedModel, setRecommendedModel] = useState('');
  const [optimizationNotes, setOptimizationNotes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const optimizePrompt = async () => {
    if (!originalPrompt.trim()) {
      setError('Please enter a prompt to optimize');
      return;
    }

    setIsLoading(true);
    setError('');
    setOptimizedPrompt('');
    setRecommendedModel('');
    setOptimizationNotes([]);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: `You are an expert at optimizing prompts for Claude AI models (Opus 4.5, Sonnet 4.5, and Haiku 4.5).

Your task is to take a vague or poorly structured prompt and transform it into a PERFECT prompt for Claude.

Apply ALL relevant best practices:
- Crystal clear instructions and context
- Proper structure with XML tags when beneficial
- Examples when they would help (few-shot prompting)
- Explicit output formatting requirements
- Chain-of-thought reasoning instructions for complex tasks
- Role assignment if beneficial
- Constraints and guidelines
- Step-by-step breakdowns for complex tasks

Additionally, recommend which Claude model is MOST OPTIMAL for this specific task:
- **Haiku 4.5**: Fast, efficient for simple, straightforward tasks
- **Sonnet 4.5**: Balanced, great for most everyday tasks requiring intelligence and speed
- **Opus 4.5**: Most capable, for highly complex reasoning, analysis, or creative tasks

Respond ONLY in this JSON format (no markdown, no code blocks, just raw JSON):
{
  "optimized_prompt": "the fully optimized prompt here",
  "recommended_model": "Opus 4.5" or "Sonnet 4.5" or "Haiku 4.5",
  "model_reasoning": "brief explanation why this model is optimal",
  "optimization_notes": [
    "specific change 1 and why it was made",
    "specific change 2 and why it was made",
    "etc"
  ]
}

Original prompt to optimize:
${originalPrompt}`
          }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.content[0].text;
      
      // Extract JSON from response (handle both raw JSON and markdown code blocks)
      let jsonStr = content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      
      const result = JSON.parse(jsonStr);
      
      // Validate response structure
      if (!result.optimized_prompt || !result.recommended_model || !result.optimization_notes) {
        throw new Error('Invalid response format from API');
      }
      
      setOptimizedPrompt(result.optimized_prompt);
      setRecommendedModel(`${result.recommended_model} - ${result.model_reasoning}`);
      setOptimizationNotes(result.optimization_notes);
      
    } catch (err) {
      setError(err.message || 'An error occurred while optimizing the prompt');
      console.error('Optimization error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const clearAll = () => {
    setOriginalPrompt('');
    setOptimizedPrompt('');
    setRecommendedModel('');
    setOptimizationNotes([]);
    setError('');
    setCopied(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(optimizedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyDown = (e) => {
    // Ctrl/Cmd + Enter to optimize
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && originalPrompt.trim() && !isLoading) {
      optimizePrompt();
    }
  };

  return (
    <div className="min-h-screen bg-black p-6 sm:p-8" style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-light text-white mb-2 tracking-tight">Claude Prompt Optimizer</h1>
          <p className="text-gray-400 font-light">Transform prompts into optimized Claude instructions</p>
        </div>

        <div className="mb-8">
          <textarea
            value={originalPrompt}
            onChange={(e) => setOriginalPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your prompt..."
            className="w-full h-32 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-white focus:border-white resize-none font-light transition-colors"
            style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}
          />
          
          <div className="mt-4 flex gap-3">
            <button
              onClick={optimizePrompt}
              disabled={isLoading || !originalPrompt.trim()}
              className="px-6 py-2.5 bg-white hover:bg-gray-200 disabled:bg-zinc-800 text-black disabled:text-gray-600 text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Optimizing...
                </>
              ) : (
                'Optimize'
              )}
            </button>
            
            <button
              onClick={clearAll}
              disabled={isLoading}
              className="px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-950/50 border border-red-900/50 rounded-lg text-red-400 text-sm font-light flex items-start gap-2">
              <X className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {optimizedPrompt && (
          <>
            {recommendedModel && (
              <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
                <div className="text-sm font-medium text-gray-400 mb-1">Recommended Model</div>
                <div className="text-white font-light">{recommendedModel}</div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div>
                <div className="text-sm font-medium text-gray-400 mb-3">Original</div>
                <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800 max-h-96 overflow-y-auto">
                  <pre className="text-gray-300 whitespace-pre-wrap text-sm font-light leading-relaxed" style={{ fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace' }}>{originalPrompt}</pre>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-gray-400">Optimized</div>
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 rounded transition-colors font-light"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800 max-h-96 overflow-y-auto">
                  <pre className="text-white whitespace-pre-wrap text-sm font-light leading-relaxed" style={{ fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace' }}>{optimizedPrompt}</pre>
                </div>
              </div>
            </div>

            {optimizationNotes.length > 0 && (
              <div className="border-t border-zinc-800 pt-6">
                <div className="text-sm font-medium text-gray-400 mb-4">Changes Made</div>
                <div className="space-y-3">
                  {optimizationNotes.map((note, index) => (
                    <div key={index} className="flex gap-3 text-sm text-gray-300 font-light leading-relaxed">
                      <span className="text-gray-600 flex-shrink-0">•</span>
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ClaudePromptOptimizer;