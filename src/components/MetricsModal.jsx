import React, { useState, useEffect } from 'react';
import { FaTimes, FaChartLine, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import './MetricsModal.css';

const MetricsModal = ({ isOpen, onClose, connectionNumber, imprisonData, loading }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [showSuccess, setShowSuccess] = useState(true);
  const [show3sError, setShow3sError] = useState(true);
  const itemsPerPage = 7;

  // Reset to page 1 when data changes
  useEffect(() => {
    setCurrentPage(1);
  }, [imprisonData.length]);

  if (!isOpen) return null;

  // Calculate pagination
  const totalPages = Math.ceil(imprisonData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPageData = imprisonData.slice(startIndex, endIndex);

  // Calculate statistics
  const stats = {
    totalImprisons: imprisonData.length,
    successfulImprisons: imprisonData.filter(d => d.isSuccess !== false).length,
    failedImprisons: imprisonData.filter(d => d.isSuccess === false).length,
    primaryImprisons: imprisonData.filter(d => d.code === 'primary').length,
    altImprisons: imprisonData.filter(d => d.code === 'alt').length,
    clanMembers: imprisonData.filter(d => d.isClan).length,
    rivals: imprisonData.filter(d => !d.isClan).length,
    avgTime: imprisonData.length > 0 
      ? Math.round(imprisonData.reduce((sum, d) => sum + d.timestamp, 0) / imprisonData.length)
      : 0,
    avgSuccessTime: imprisonData.filter(d => d.isSuccess !== false).length > 0
      ? Math.round(imprisonData.filter(d => d.isSuccess !== false).reduce((sum, d) => sum + d.timestamp, 0) / imprisonData.filter(d => d.isSuccess !== false).length)
      : 0,
    avg3sTime: imprisonData.filter(d => d.isSuccess === false).length > 0
      ? Math.round(imprisonData.filter(d => d.isSuccess === false).reduce((sum, d) => sum + d.timestamp, 0) / imprisonData.filter(d => d.isSuccess === false).length)
      : 0
  };

  // Filter data based on toggles
  const filteredData = imprisonData.filter(d => {
    const isSuccess = d.isSuccess !== false;
    if (isSuccess && !showSuccess) return false;
    if (!isSuccess && !show3sError) return false;
    return true;
  });

  // Graph configuration - Focused range 1500-2300ms
  const GRAPH_MIN_TIME = 1500;
  const GRAPH_MAX_TIME = 2300;
  const GRAPH_TIME_RANGE = GRAPH_MAX_TIME - GRAPH_MIN_TIME;
  
  // Calculate point positions for scatter plot
  const getPointPosition = (timestamp) => {
    // Clamp timestamp to graph range
    const clampedTime = Math.max(GRAPH_MIN_TIME, Math.min(GRAPH_MAX_TIME, timestamp));
    const x = ((clampedTime - GRAPH_MIN_TIME) / GRAPH_TIME_RANGE) * 85 + 8; // 8% left margin, 85% width
    return x;
  };

  // Handle point hover
  const handlePointHover = (data, event) => {
    setHoveredPoint(data);
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top
    });
  };

  return (
    <div className="metrics-modal-overlay" onClick={onClose}>
      <div className="metrics-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="metrics-header">
          <div className="metrics-title">
            <FaChartLine />
            CONNECTION {connectionNumber} METRICS
          </div>
          <button className="metrics-close-btn" onClick={onClose}>
            <FaTimes />
          </button>
        </div>

        {/* Content */}
        <div className="metrics-content">
          {loading ? (
            <div className="no-data">
              <div className="no-data-icon">⏳</div>
              <div className="no-data-text">Loading Metrics...</div>
            </div>
          ) : imprisonData.length === 0 ? (
            <div className="no-data">
              <div className="no-data-icon">📊</div>
              <div className="no-data-text">No Imprisonment Data Yet</div>
              <div className="no-data-subtext">
                Start using Connection {connectionNumber} to see metrics here
              </div>
            </div>
          ) : (
            <>
              {/* Stats Grid - Compact Premium */}
              <div className="metrics-stats-grid-premium">
                <div className="stat-card-premium">
                  <div className="stat-label-premium">TOTAL</div>
                  <div className="stat-value-premium">{stats.totalImprisons}</div>
                </div>
                <div className="stat-card-premium success">
                  <div className="stat-label-premium">✅ SUCCESS</div>
                  <div className="stat-value-premium">{stats.successfulImprisons}</div>
                  <div className="stat-sublabel-premium">Avg: {stats.avgSuccessTime}ms</div>
                </div>
                <div className="stat-card-premium error">
                  <div className="stat-label-premium">❌ 3S ERROR</div>
                  <div className="stat-value-premium">{stats.failedImprisons}</div>
                  <div className="stat-sublabel-premium">Avg: {stats.avg3sTime}ms</div>
                </div>
                <div className="stat-card-premium">
                  <div className="stat-label-premium">SUCCESS RATE</div>
                  <div className="stat-value-premium">
                    {stats.totalImprisons > 0 
                      ? Math.round((stats.successfulImprisons / stats.totalImprisons) * 100) 
                      : 0}%
                  </div>
                </div>
              </div>

              {/* Timeline Graph */}
              <div className="metrics-graph-container">
                <div className="graph-header">
                  <div className="graph-title">Timing Distribution (1500-2300ms)</div>
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
                  
                  {/* Vertical grid lines (every 100ms) */}
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
                  
                  {/* X-axis labels (every 200ms) */}
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

                  {/* Data points - Scatter plot style */}
                  {filteredData.map((data, index) => {
                    const isSuccess = data.isSuccess !== false;
                    const x = getPointPosition(data.timestamp);
                    
                    // Position: Success points at 30% height, Error points at 70% height
                    const y = isSuccess ? 30 : 70;
                    
                    // Add slight random offset to prevent overlapping
                    const randomOffset = (Math.random() - 0.5) * 3;
                    
                    return (
                      <div
                        key={index}
                        className={`timeline-dot ${isSuccess ? 'success' : 'error'}`}
                        style={{
                          left: `${x}%`,
                          top: `${y + randomOffset}%`
                        }}
                        onMouseEnter={(e) => handlePointHover(data, e)}
                        onMouseLeave={() => setHoveredPoint(null)}
                      />
                    );
                  })}

                  {/* Tooltip */}
                  {hoveredPoint && hoveredPoint.playerName && (
                    <div
                      className="timeline-tooltip"
                      style={{
                        left: `${tooltipPos.x}px`,
                        top: `${tooltipPos.y}px`,
                        position: 'fixed'
                      }}
                    >
                      <div className="tooltip-row">
                        <span className="tooltip-label">Player:</span>
                        <span className="tooltip-value">{hoveredPoint.playerName}</span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Time:</span>
                        <span className="tooltip-value">{hoveredPoint.timestamp}ms</span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Type:</span>
                        <span className="tooltip-value">
                          {hoveredPoint.isClan ? '👥 Clan Member' : '⚔️ Rival'}
                        </span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Result:</span>
                        <span className="tooltip-value">
                          {hoveredPoint.isSuccess !== false ? '✅ Success' : '❌ 3S Error'}
                        </span>
                      </div>
                      <div className="tooltip-row">
                        <span className="tooltip-label">Code:</span>
                        <span className="tooltip-value">
                          {hoveredPoint.code === 'primary' ? 'Primary' : 'Alt'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Imprison List with Pagination */}
              <div className="imprison-list-container-compact">
                <div className="imprison-list-header-compact">
                  <span>Recent Attempts</span>
                  <span className="page-info">
                    Page {currentPage} of {totalPages} ({imprisonData.length} total)
                  </span>
                </div>
                <table className="imprison-table-compact">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Time</th>
                      <th>Player</th>
                      <th>Code</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageData.map((data, index) => {
                      const globalIndex = startIndex + index + 1;
                      return (
                        <tr key={index}>
                          <td>{globalIndex}</td>
                          <td className="time-cell">{data.timestamp}ms</td>
                          <td className="player-cell">{data.playerName}</td>
                          <td>
                            <span className={`code-badge-compact ${data.code}`}>
                              {data.code === 'primary' ? 'P' : 'A'}
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
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetricsModal;
