import React, { useState, useEffect, useRef } from 'react';
import { FaTimes, FaBrain, FaChevronLeft, FaChevronRight, FaDownload } from 'react-icons/fa';
import './MLLearningModal.css';

const MLLearningModal = ({ isOpen, onClose, connectionNumber, backendUrl, userId }) => {
  const [learningData, setLearningData] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showSuccess, setShowSuccess] = useState(true);
  const [show3sError, setShow3sError] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const itemsPerPage = 7;
  const hasLoadedOnce = useRef(false);
  const modalRef = useRef(null);

  // Fetch ML learning data when modal opens
  useEffect(() => {
    if (isOpen && connectionNumber && backendUrl && userId) {
      // Reset state and fetch fresh data
      setLearningData([]);
      setStats(null);
      hasLoadedOnce.current = false; // Reset on modal open
      fetchLearningData();
    }
  }, [isOpen]);

  // Auto-refresh data every 3 seconds when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const refreshInterval = setInterval(() => {
      fetchLearningData();
    }, 3000); // Refresh every 3 seconds

    return () => clearInterval(refreshInterval);
  }, [isOpen, connectionNumber, backendUrl, userId]);

  const fetchLearningData = async () => {
    // Only show loading on the very first load
    if (!hasLoadedOnce.current) {
      setLoading(true);
    }
    
    try {
      const response = await fetch(`${backendUrl}/api/metrics/${connectionNumber}`, {
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
          'x-user-id': userId
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch learning data');
      }

      const result = await response.json();
      
      if (result.success && result.data) {
        // Filter only records with timing data (ML learning records)
        const mlData = result.data.filter(d => d.timingValue && d.timingType);
        setLearningData(mlData);
        calculateStats(mlData);
        hasLoadedOnce.current = true; // Mark as loaded
      }
    } catch (error) {
      console.error('Error fetching ML learning data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (data) => {
    if (data.length === 0) {
      setStats(null);
      return;
    }

    const successData = data.filter(d => d.isSuccess !== false);
    const errorData = data.filter(d => d.isSuccess === false);
    const attackData = data.filter(d => d.timingType === 'attack');
    const defenseData = data.filter(d => d.timingType === 'defense');

    // Context stats
    const fastData = data.filter(d => d.context === 'FAST');
    const normalData = data.filter(d => d.context === 'NORMAL');
    const slowData = data.filter(d => d.context === 'SLOW');

    // Calculate timing evolution (first vs last 5)
    const first5 = data.slice(0, 5);
    const last5 = data.slice(-5);
    const avgFirst5 = first5.length > 0 
      ? Math.round(first5.reduce((sum, d) => sum + d.timingValue, 0) / first5.length)
      : 0;
    const avgLast5 = last5.length > 0
      ? Math.round(last5.reduce((sum, d) => sum + d.timingValue, 0) / last5.length)
      : 0;
    const improvement = avgFirst5 - avgLast5;

    setStats({
      totalAttempts: data.length,
      successCount: successData.length,
      errorCount: errorData.length,
      successRate: Math.round((successData.length / data.length) * 100),
      
      // Timing stats
      avgTiming: Math.round(data.reduce((sum, d) => sum + d.timingValue, 0) / data.length),
      avgSuccessTiming: successData.length > 0
        ? Math.round(successData.reduce((sum, d) => sum + d.timingValue, 0) / successData.length)
        : 0,
      avgErrorTiming: errorData.length > 0
        ? Math.round(errorData.reduce((sum, d) => sum + d.timingValue, 0) / errorData.length)
        : 0,
      
      // Type stats
      attackCount: attackData.length,
      defenseCount: defenseData.length,
      attackSuccessRate: attackData.length > 0
        ? Math.round((attackData.filter(d => d.isSuccess !== false).length / attackData.length) * 100)
        : 0,
      defenseSuccessRate: defenseData.length > 0
        ? Math.round((defenseData.filter(d => d.isSuccess !== false).length / defenseData.length) * 100)
        : 0,
      
      // Context stats
      fastCount: fastData.length,
      normalCount: normalData.length,
      slowCount: slowData.length,
      avgPing: data.filter(d => d.pingMs).length > 0
        ? Math.round(data.filter(d => d.pingMs).reduce((sum, d) => sum + d.pingMs, 0) / data.filter(d => d.pingMs).length)
        : 0,
      
      // Learning progress
      avgFirst5,
      avgLast5,
      improvement,
      currentTiming: data.length > 0 ? data[data.length - 1].timingValue : 0
    });
  };

  // Reset to page 1 when data changes
  useEffect(() => {
    setCurrentPage(1);
  }, [learningData.length]);

  if (!isOpen) return null;

  // Calculate pagination
  const totalPages = Math.ceil(learningData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPageData = learningData.slice(startIndex, endIndex);

  // Filter data based on toggles
  const filteredData = learningData.filter(d => {
    const isSuccess = d.isSuccess !== false;
    if (isSuccess && !showSuccess) return false;
    if (!isSuccess && !show3sError) return false;
    return true;
  });

  // Graph configuration
  const GRAPH_MIN_TIME = 1500;
  const GRAPH_MAX_TIME = 2300;
  const GRAPH_TIME_RANGE = GRAPH_MAX_TIME - GRAPH_MIN_TIME;
  
  const getPointPosition = (timing) => {
    const clampedTime = Math.max(GRAPH_MIN_TIME, Math.min(GRAPH_MAX_TIME, timing));
    const x = ((clampedTime - GRAPH_MIN_TIME) / GRAPH_TIME_RANGE) * 85 + 8;
    return x;
  };

  const handlePointHover = (data, event) => {
    setHoveredPoint(data);

    // Use position relative to the timeline-graph container (position:relative)
    // so tooltip stays inside the graph and never escapes modal bounds
    const graphEl = event.currentTarget.closest('.timeline-graph');
    if (!graphEl) return;

    const graphRect = graphEl.getBoundingClientRect();
    const dotRect = event.currentTarget.getBoundingClientRect();
    const tooltipWidth = 250;
    const tooltipHeight = 210;
    const padding = 8;

    // Dot center relative to graph container
    const dotCenterX = dotRect.left + dotRect.width / 2 - graphRect.left;
    const dotTopY = dotRect.top - graphRect.top;

    // Start: centered above the dot
    let x = dotCenterX - tooltipWidth / 2;
    let y = dotTopY - tooltipHeight - padding;

    // Clamp right edge inside graph
    if (x + tooltipWidth > graphRect.width - padding) {
      x = graphRect.width - tooltipWidth - padding;
    }
    // Clamp left edge inside graph
    if (x < padding) {
      x = padding;
    }
    // If goes above graph top, show below the dot
    if (y < padding) {
      y = dotTopY + dotRect.height + padding;
    }

    setTooltipPos({ x, y });
  };

  const exportData = () => {
    const exportObj = {
      connection: connectionNumber,
      timestamp: new Date().toISOString(),
      stats: stats,
      learningData: learningData
    };
    
    const dataStr = JSON.stringify(exportObj, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `conn${connectionNumber}_ml_learning_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ml-modal-overlay" onClick={onClose}>
      <div className="ml-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ml-header">
          <div className="ml-title">
            <FaBrain />
            AI CORE DASHBOARD - CONNECTION {connectionNumber}
          </div>
          <button className="ml-close-btn" onClick={onClose}>
            <FaTimes />
          </button>
        </div>

        {/* Content */}
        <div className="ml-content">
          {loading ? (
            <div className="ml-loading">
              <div className="loading-spinner"></div>
              <div>Loading ML data...</div>
            </div>
          ) : learningData.length === 0 ? (
            <div className="no-data">
              <div className="no-data-icon">🧠</div>
              <div className="no-data-text">No ML Learning Data Yet</div>
              <div className="no-data-subtext">
                Enable AI Core for Connection {connectionNumber} to start learning
              </div>
            </div>
          ) : (
            <>
              {/* Stats Grid */}
              <div className="ml-stats-grid">
                <div className="ml-stat-card">
                  <div className="stat-label-premium">TOTAL ATTEMPTS</div>
                  <div className="stat-value-premium">{stats.totalAttempts}</div>
                </div>
                <div className="ml-stat-card success">
                  <div className="stat-label-premium">✅ SUCCESS RATE</div>
                  <div className="stat-value-premium">{stats.successRate}%</div>
                  <div className="stat-sublabel-premium">{stats.successCount} / {stats.totalAttempts}</div>
                </div>
                <div className="ml-stat-card">
                  <div className="stat-label-premium">CURRENT TIMING</div>
                  <div className="stat-value-premium">{stats.currentTiming}ms</div>
                  <div className="stat-sublabel-premium">
                    {stats.improvement > 0 ? `↓ ${stats.improvement}ms faster` : 
                     stats.improvement < 0 ? `↑ ${Math.abs(stats.improvement)}ms slower` : 
                     'No change'}
                  </div>
                </div>
                <div className="ml-stat-card">
                  <div className="stat-label-premium">AVG PING</div>
                  <div className="stat-value-premium">{stats.avgPing}ms</div>
                  <div className="stat-sublabel-premium">
                    {stats.fastCount > 0 && `FAST: ${stats.fastCount} `}
                    {stats.normalCount > 0 && `NORMAL: ${stats.normalCount} `}
                    {stats.slowCount > 0 && `SLOW: ${stats.slowCount}`}
                  </div>
                </div>
              </div>

              {/* Secondary Stats */}
              <div className="ml-stats-secondary">
                <div className="ml-stat-small">
                  <span className="stat-label-small">Attack:</span>
                  <span className="stat-value-small">{stats.attackCount} ({stats.attackSuccessRate}%)</span>
                </div>
                <div className="ml-stat-small">
                  <span className="stat-label-small">Defense:</span>
                  <span className="stat-value-small">{stats.defenseCount} ({stats.defenseSuccessRate}%)</span>
                </div>
                <div className="ml-stat-small">
                  <span className="stat-label-small">Avg Success:</span>
                  <span className="stat-value-small">{stats.avgSuccessTiming}ms</span>
                </div>
                <div className="ml-stat-small">
                  <span className="stat-label-small">Avg Error:</span>
                  <span className="stat-value-small">{stats.avgErrorTiming}ms</span>
                </div>
              </div>


              {/* Timeline Graph */}
              <div className="ml-graph-container">
                <div className="graph-header">
                  <div className="graph-title">AI Core Evolution (1775-2150ms)</div>
                  <div className="graph-filters">
                    <button 
                      className={`filter-toggle ${showSuccess ? 'active' : ''}`}
                      onClick={() => setShowSuccess(!showSuccess)}
                    >
                      ✅ Success
                    </button>
                    <button 
                      className={`filter-toggle ${show3sError ? 'active' : ''}`}
                      onClick={() => setShow3sError(!show3sError)}
                    >
                      ❌ 3S Error
                    </button>
                  </div>
                </div>

                <div className="timeline-graph">
                  {/* Y-axis */}
                  <div className="timeline-y-axis"></div>
                  
                  {/* X-axis */}
                  <div className="timeline-axis"></div>
                  
                  {/* Vertical grid lines */}
                  {[1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300].map(time => {
                    const x = getPointPosition(time);
                    return (
                      <div
                        key={`grid-${time}`}
                        className="timeline-grid-line"
                        style={{ left: `${x}%` }}
                      />
                    );
                  })}
                  
                  {/* X-axis labels */}
                  {[1500, 1700, 1900, 2100, 2300].map(time => {
                    const x = getPointPosition(time);
                    return (
                      <div
                        key={`label-${time}`}
                        className="timeline-label x-axis"
                        style={{ left: `${x}%` }}
                      >
                        {time}ms
                      </div>
                    );
                  })}

                  {/* Y-axis labels */}
                  <div className="timeline-label y-axis-status success-label" style={{ top: '30%' }}>
                    Success
                  </div>
                  <div className="timeline-label y-axis-status error-label" style={{ top: '70%' }}>
                    Error
                  </div>

                  {/* Data points with learning progression */}
                  {filteredData.map((data, index) => {
                    const isSuccess = data.isSuccess !== false;
                    const x = getPointPosition(data.timingValue);
                    const y = isSuccess ? 30 : 70;
                    const randomOffset = (Math.random() - 0.5) * 3;
                    
                    // Calculate opacity based on recency (newer = more opaque)
                    const opacity = 0.3 + (index / filteredData.length) * 0.7;
                    
                    return (
                      <div
                        key={index}
                        className={`timeline-dot ${isSuccess ? 'success' : 'error'} ${data.timingType}`}
                        style={{
                          left: `${x}%`,
                          top: `${y + randomOffset}%`,
                          opacity: opacity
                        }}
                        onMouseEnter={(e) => handlePointHover(data, e)}
                        onMouseLeave={() => setHoveredPoint(null)}
                      />
                    );
                  })}

                  {/* Tooltip */}
                  {hoveredPoint && (
                    <div
                      className="timeline-tooltip"
                      style={{
                        left: `${tooltipPos.x}px`,
                        top: `${tooltipPos.y}px`
                      }}
                    >
                      <div className="tooltip-row">
                        <span className="tooltip-label">Player:</span>
                        <span className="tooltip-value">{hoveredPoint.playerName}</span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Timing:</span>
                        <span className="tooltip-value">{hoveredPoint.timingValue}ms</span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Type:</span>
                        <span className="tooltip-value">
                          {hoveredPoint.timingType === 'attack' ? '⚔️ Attack' : '🛡️ Defense'}
                        </span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Ping:</span>
                        <span className="tooltip-value">{hoveredPoint.pingMs || 'N/A'}ms</span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Context:</span>
                        <span className="tooltip-value">{hoveredPoint.context || 'N/A'}</span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Result:</span>
                        <span className="tooltip-value">
                          {hoveredPoint.isSuccess !== false ? '✅ Success' : '❌ 3S Error'}
                        </span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Time:</span>
                        <span className="tooltip-value">
                          {new Date(hoveredPoint.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Learning History Table */}
              <div className="ml-list-container">
                <div className="ml-list-header">
                  <span>Learning History</span>
                  <span className="page-info">
                    Page {currentPage} of {totalPages} ({learningData.length} total)
                  </span>
                </div>
                <table className="ml-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Time</th>
                      <th>Rival</th>
                      <th>Timing</th>
                      <th>Type</th>
                      <th>Ping</th>
                      <th>Context</th>
                      <th>Reason</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageData.map((data, index) => {
                      const globalIndex = startIndex + index + 1;
                      return (
                        <tr key={index}>
                          <td>{globalIndex}</td>
                          <td className="time-cell">
                            {new Date(data.createdAt).toLocaleTimeString()}
                          </td>
                          <td className="rival-cell" title={data.playerName}>
                            {data.playerName || 'Unknown'}
                          </td>
                          <td className="timing-cell">{data.timingValue}ms</td>
                          <td>
                            <span className={`type-badge ${data.timingType}`}>
                              {data.timingType === 'attack' ? '⚔️' : '🛡️'}
                            </span>
                          </td>
                          <td className="ping-cell">{data.pingMs || 'N/A'}ms</td>
                          <td>
                            <span className={`context-badge ${data.context?.toLowerCase()}`}>
                              {data.context || 'N/A'}
                            </span>
                          </td>
                          <td>
                            <span className={`reason-badge ${data.adjustmentReason?.toLowerCase()}`}>
                              {data.adjustmentReason === 'STUCK_ESCAPE' ? '🔧' :
                               data.adjustmentReason === '3S_ERROR' ? '⚠️' :
                               data.adjustmentReason === 'SUCCESS' ? '✅' :
                               data.adjustmentReason === 'FAILURE' ? '❌' :
                               data.adjustmentReason === 'DB_INIT' ? '📊' :
                               data.adjustmentReason === 'INIT' ? '🎯' :
                               data.adjustmentReason || 'N/A'}
                            </span>
                          </td>
                          <td>
                            <span className={`result-badge-compact ${data.isSuccess !== false ? 'success' : 'error'}`}>
                              {data.isSuccess !== false ? '✅' : '❌'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="pagination-controls">
                    <button 
                      className="pagination-btn"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      <FaChevronLeft />
                    </button>
                    <span className="pagination-text">
                      {currentPage} / {totalPages}
                    </span>
                    <button 
                      className="pagination-btn"
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                    >
                      <FaChevronRight />
                    </button>
                  </div>
                )}

                {/* Export Button */}
                <button className="export-btn-compact" onClick={exportData}>
                  <FaDownload />
                  Export ML Data
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MLLearningModal;
