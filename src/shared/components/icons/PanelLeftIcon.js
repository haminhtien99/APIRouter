"use client";

import PropTypes from "prop-types";

export default function PanelLeftIcon({ size = 18, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2" />
      <path d="M5.75 1.75v12.5" />
    </svg>
  );
}

PanelLeftIcon.propTypes = {
  size: PropTypes.number,
  className: PropTypes.string,
};
