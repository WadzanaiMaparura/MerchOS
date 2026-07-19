const manualProcess = [
  'Supplier PDFs, WhatsApp images, Excel files',
  'Hours spent cleaning and formatting data',
  'Inconsistent product descriptions and titles',
  'High listing rejection rates',
  'Manual CSV creation and uploads',
  'Lost sales and wasted time',
];

const automatedProcess = [
  'Automated import from any supplier format',
  'Data processed and structured in seconds',
  'MerchOS Enhancement for clean, consistent data',
  'Marketplace Validation to ensure compliance',
  'Export ready listings for any marketplace',
  'More sales, less effort, business growth',
];

export default function WorkflowSection() {
  return (
    <section id="how-it-works" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block text-xs uppercase tracking-wider text-blue-600 font-semibold mb-4">
            Workflow Transformation
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Manual Process <span className="text-gray-400">→</span> Automated Process
          </h2>
        </div>

        {/* Comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 lg:gap-12 items-start">
          {/* Manual Process */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Manual Process</h3>
            <ul className="space-y-4">
              {manualProcess.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-red-500 shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-gray-600">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Center divider with logo */}
          <div className="hidden lg:flex flex-col items-center justify-center self-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">M</span>
            </div>
            <div className="flex items-center gap-1 text-blue-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
          </div>

          {/* Mobile arrow */}
          <div className="lg:hidden flex justify-center">
            <div className="flex items-center gap-2 text-blue-400">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">M</span>
              </div>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          </div>

          {/* MerchOS Workflow */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-8 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <h3 className="text-lg font-bold text-gray-900 mb-6">MerchOS Workflow</h3>
            <ul className="space-y-4">
              {automatedProcess.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-green-500 shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
