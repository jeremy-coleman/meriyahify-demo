//import PropTypes from 'prop-types';
import * as React from "react";

export const EXAMPLE_POPUP_ID = "example-popup";

export const CLOSE_BUTTON_ID = "cancel";

export const ABOUT_POPUP_ID = "about-popup";
export const GITHUB_BUTTON_ID = "github";

export const CIRCLE_ID_PREFIX = "circle-";

export const NEW_BUTTON_ID = "new-circle";
export const CLEAR_BUTTON_ID = "clear";
export const OPEN_BUTTON_ID = "open-popup";
export const STAR_BUTTON_ID = "star";

export const AboutPopup = (props) => {
  return (
    <div>
      <div className="popup-overlay"></div>
      <div className="flex-parent-centered">
        <div id={ABOUT_POPUP_ID} className="popup-dialog">
          <span className="popup-dialog-header">About</span>
          <div className="popup-dialog-content">
            <p>
              This demo was built using{" "}
              <a href="https://facebook.github.io/react/" target={"_blank"}>
                ReactJS
              </a>{" "}
              and{" "}
              <a href="https://github.com/dkozar/raycast-dom" target={"_blank"}>
                Raycast
              </a>
              .
            </p>
            <p>
              It is a proof of concept that one could build relatively complex
              apps using Raycast, without using any of the "classic" React event
              handlers.
            </p>
            <p className="popup-dialog-content-quote">
              To see the code, please visit the project page on GitHub.
            </p>
          </div>
          <div className="popup-dialog-footer">
            <button className="toolbar-button" id={GITHUB_BUTTON_ID}>
              <span className="fa fa-github-alt"></span>&nbsp;&nbsp;Go to GitHub
            </button>
            <button className="toolbar-button" id={CLOSE_BUTTON_ID}>
              <span className="fa fa-close"></span>&nbsp;&nbsp;Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const BottomToolbar = (props) => {
  return (
    <div className="toolbar toolbar-bottom">
      <button id={CLEAR_BUTTON_ID} className="toolbar-button">
        <i className="fa fa-remove"></i>&nbsp;&nbsp;Clear
      </button>
      <button id={NEW_BUTTON_ID} className="toolbar-button">
        <i className="fa fa-plus-circle"></i>&nbsp;&nbsp;New circle
      </button>
      <button id={OPEN_BUTTON_ID} className="toolbar-button">
        <i className="fa fa-info-circle"></i>&nbsp;&nbsp;Open popup
      </button>
      <button
        id={STAR_BUTTON_ID}
        className="toolbar-button toolbar-button-right"
      >
        <i className="fa fa-star"></i>
      </button>
    </div>
  );
};

export const Circle = (props) => {
  var isHovered = props.hovered,
    shouldShowLine = isHovered || props.selected,
    config = {
      cx: props.x,
      cy: props.y,
      r: props.r,
      fill: props.color,
      strokeWidth: shouldShowLine ? 5 : 0,
      stroke: isHovered ? props.strokeColorHovered : props.strokeColorSelected,
    };
  return <circle {...config} id={props.id} />;
};

// Circle.propTypes = {
//     id: PropTypes.string.isRequired,
//     strokeColorSelected: PropTypes.string,
//     strokeColorHovered: PropTypes.string,
//     selected: PropTypes.bool,
//     hovered: PropTypes.bool
// };

Circle.defaultProps = {
  strokeColorSelected: "white",
  strokeColorHovered: "white",
  selected: false,
  hovered: false,
};
export const CursorOverlay = (props) => {
  return <div className="cursor-overlay"></div>;
};
export const ExamplePopup = (props) => {
  return (
    <div>
      <div className="popup-overlay"></div>
      <div className="flex-parent-centered">
        <div id={EXAMPLE_POPUP_ID} className="popup-dialog">
          <span className="popup-dialog-header">Example popup</span>
          <div className="popup-dialog-content">
            <p>This is the popup.</p>
            <ul>
              <li>Clicking outside this popup will close it.</li>
              <li>Clicking inside will keep it open.</li>
            </ul>
            <p className="popup-dialog-content-quote">
              [ with rays, it's easy to test an element against clicking outside
              ]
            </p>
          </div>
          <div className="popup-dialog-footer">
            <button className="toolbar-button" id={CLOSE_BUTTON_ID}>
              <span className="fa fa-close"></span>&nbsp;&nbsp;Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Logo = (props) => {
  return (
    <div className="flex-parent-centered transparent-for-clicks">
      <div className="logo">
        <div className="logo-title">Raycast demo</div>
        <div className="logo-subtitle">[ touch the screen ]</div>
      </div>
    </div>
  );
};
export function Svg(props) {
  return (
    <svg x={props.top} width={props.width} height={props.height}>
      {props.children}
    </svg>
  );
}

const texts = [
  "Click the circle to bring it to the top.",
  "Click the background to create new circle.",
  "Click and drag the circle to move all the circles.",
  "Shift + click = clear screen",
  "Alt + click + mouse move = new circle",
  '"Clear" button removes all the circles.',
  '"New circle" button creates the circle at last click position.',
];

export const TextRotator = () => {
  return (
    <span className="top-left-instructions">
      {texts.map((t) => (
        <p key={t}>{t}</p>
      ))}
    </span>
  );
};
