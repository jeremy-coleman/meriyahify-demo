import * as React from 'react'
import {Emitter, Ray} from "./Raycast";

import {
  AboutPopup,
  ABOUT_POPUP_ID,
  BottomToolbar,
  Circle,
  CIRCLE_ID_PREFIX,
  CLEAR_BUTTON_ID,
  CLOSE_BUTTON_ID,
  CursorOverlay,
  ExamplePopup,
  EXAMPLE_POPUP_ID,
  GITHUB_BUTTON_ID,
  Logo,
  NEW_BUTTON_ID,
  OPEN_BUTTON_ID,
  STAR_BUTTON_ID,
  Svg,
  TextRotator,
} from "./components";

import "./main.css";

//asdf = 2324d;
//just for the error demo
let x: number = 'not a number'

const GITHUB_URL = "https://github.com/dkozar/raycast-dom";
const STARS_URL = GITHUB_URL + "/stargazers";
const PURPLE = "#8e44ad";
const ORANGE = "#e67e22";
const RED = "#e74c3c";
const BLUE = "#2980b9";
const YELLOW = "#f1c40f";
const COLORS = [PURPLE, ORANGE, RED, BLUE, YELLOW];

const TOOLBAR_HEIGHT = 0;

function getCircleId(circleElement) {
  return parseInt(circleElement.id.split("-")[1]);
}

class ViewportUtil {
  static getRect() {
    var doc = document.documentElement;
    var body = document.body;

    return {
      x: 0,
      y: 0,
      width: window.innerWidth || doc.clientWidth || body.clientWidth,
      height: window.innerHeight || doc.clientHeight || body.clientHeight,
    };
  }
}

function bringToFront(circles, circle, current) {
  circles.splice(current, 1);
  circles.push(circle);
}

function sendToBack(circles, circle, current) {
  circles.splice(current, 1);
  circles.unshift(circle);
}

function newCircle(position, circles, yOrigin) {
  console.log("new circle");
  var r = Math.floor(Math.random() * 150) + 50,
    color = COLORS[Math.floor(Math.random() * COLORS.length)],
    circle = {
      x: position.x,
      y: position.y - yOrigin,
      r,
      color,
    };

  circles.push(circle);
}

function randomCircle(circles, yOrigin) {
  var viewportRect = ViewportUtil.getRect(),
    x = Math.floor(Math.random() * viewportRect.width),
    y = Math.floor(Math.random() * viewportRect.height),
    r = Math.floor(Math.random() * 150) + 50,
    color = COLORS[Math.floor(Math.random() * COLORS.length)],
    circle = {
      x,
      y: y - yOrigin,
      r,
      color,
    };

  circles.push(circle);
}

function removeCircle(circles, current) {
  circles.splice(current, 1);
}

function moveCircles(circles, delta) {
  circles.forEach(function(circle) {
    circle.x += delta.x;
    circle.y += delta.y;
  });
}

function clear(circles) {
  circles.splice(0, circles.length);
}

export class CircleOps {
  //<editor-fold desc="Circles & commands">
  static executeCommand(command, circles, current, position) {
    var circle = circles[current],
      transformed = false;

    switch (command) {
      case "increase-x":
        circle.x += 10;
        transformed = true;
        break;
      case "decrease-x":
        circle.x -= 10;
        transformed = true;
        break;
      case "increase-y":
        circle.y += 10;
        transformed = true;
        break;
      case "decrease-y":
        circle.y -= 10;
        transformed = true;
        break;
      case "increase-r":
        circle.r += 10;
        transformed = true;
        break;
      case "decrease-r":
        circle.r -= 10;
        transformed = true;
        break;
      case "bring-to-front":
        bringToFront(circles, circle, current);
        break;
      case "send-to-back":
        sendToBack(circles, circle, current);
        break;
      case "new-circle":
        newCircle(position, circles, TOOLBAR_HEIGHT);
        break;
      case "random-circle":
        randomCircle(circles, TOOLBAR_HEIGHT);
        break;
      case "remove-circle":
        removeCircle(circles, current);
        break;
      case "move":
        moveCircles(circles, position);
        break;
      case "clear":
        clear(circles);
        break;
    }

    if (transformed) {
      circle.x = Math.max(circle.x, 10);
      circle.y = Math.max(circle.y, 10);
      circle.r = Math.max(circle.r, 10);
    }

    return circles;
  }
}

// @see https://github.com/dkozar/edriven-gui/blob/master/eDriven/eDriven.Core/Geom/Point.cs

class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  add(other) {
    return new Point(this.x + other.x, this.y + other.y);
  }
  subtract(other) {
    return new Point(this.x - other.x, this.y - other.y);
  }
  toObject() {
    return {
      x: this.x,
      y: this.y,
    };
  }
  static fromObject(obj) {
    return new Point(obj.x, obj.y);
  }
}

export class App extends React.Component<any, any> {
  canvasRef = React.createRef<any>();
  rootRef = React.createRef<any>();
  
  constructor(props) {
    super(props);

    this.state = {
      circles: [
        {
          x: 150,
          y: 500,
          r: 100,
          color: BLUE,
        },
        {
          x: 700,
          y: 250,
          r: 150,
          color: YELLOW,
        },
        {
          x: 800,
          y: 700,
          r: 80,
          color: PURPLE,
        },
      ],
      hoveredCircleIndex: -1,
      selectedCircleIndex: -1,
      draggedCircleIndex: -1,
      popupVisible: ABOUT_POPUP_ID as string | boolean,
      mousePosition: {
        x: 0,
        y: 0,
      },
      mouseIsDown: false,
      isTouch: false,
      dragOrigin: undefined as any,
      delta: undefined as any,
    };

    this.executeCommand = this.executeCommand.bind(this);

    // Raycast Emitter subscription
    Emitter.getInstance().connect({
      onMouseOver: this.onMouseOver.bind(this), // circle mouse over
      onMouseOut: this.onMouseOut.bind(this), // circle mouse out
      onMouseMove: this.onMouseMove.bind(this), // drawing circles with Alt key
      onMouseDown: this.onMouseDown.bind(this), // drawing circles
      onMouseUp: this.onMouseUp.bind(this), // stop drawing circles with Alt key
      onClick: this.onClick.bind(this), // button clicks
      onKeyDown: this.onKeyDown.bind(this), // stop dragging
      onKeyUp: this.onKeyUp.bind(this), // closing dialog
      onTouchStart: this.onTouchStart.bind(this), // new circle
      onTouchEnd: this.onTouchEnd.bind(this),
      onTouchMove: this.onTouchMove.bind(this),
    });
  }

  onMouseOver(ray: Ray) {
    var circle = ray.intersectsId(CIRCLE_ID_PREFIX),
      circleId,
      circleIndex;

    if (circle) {
      // circle mouse over
      circleId = circle.id;
      circleIndex = parseInt(circleId.split(CIRCLE_ID_PREFIX)[1]);
      this.setState({
        hoveredCircleIndex: circleIndex,
      });
    }
  }

  onMouseOut(ray: Ray) {
    var circle = ray.intersectsId(CIRCLE_ID_PREFIX);
    // circle mouse over
    if (circle) {this.setState({hoveredCircleIndex: -1})}
  }

  //<editor-fold desc="Mouse/touch down">
  handleMouseOrTouchDown(ray: Ray, isTouch?) {
    var self = this;
    var circle;
    var circleId;
    var circleIndex;

     // immediately reset cursor overlay
    this.setState({mouseIsDown: true,isTouch});

    if (this.state.popupVisible) {
      // popup is visible
      if (!ray.intersectsId(EXAMPLE_POPUP_ID) && !ray.intersectsId(ABOUT_POPUP_ID)) {
        // clicked outside the popup
        this.setState({popupVisible: false});
      }
       // return because popup currently visible
      return;
    }

    // clicked outside the canvas
    if (!ray.intersects(this.canvasRef.current)) { return;}

    circle = ray.intersectsId(CIRCLE_ID_PREFIX);

    // circle mouse down
    if (circle) {
      circleId = circle.id;
      circleIndex = parseInt(circleId.split(CIRCLE_ID_PREFIX)[1]);
      this.setState(
        {
          selectedCircleIndex: circleIndex,
          draggedCircleIndex: circleIndex,
          dragOrigin: ray.position,
        },
        function() {
          self.executeCommand("bring-to-front");
          self.selectCircleOnTop();
        },
      );
      return;
    }

    // canvas mouse down
    this.setState(
      {
        mousePosition: ray.position,
        selectedCircleIndex: -1,
        draggedCircleIndex: -1,
      },
      function() {
        if (ray.e.shiftKey) {
          // Shift + click = clear screen
          self.executeCommand("clear");
        }
        self.executeCommand("new-circle"); // create new circle
        self.selectCircleOnTop(); // select it
      },
    );
  }

  onMouseDown(ray: Ray) {
    this.handleMouseOrTouchDown(ray);
  }

  onTouchStart(ray: Ray) {
    var touch = ray.e.changedTouches[0];

    ray.position = {
      x: touch.clientX,
      y: touch.clientY,
    };
    this.handleMouseOrTouchDown(ray, true);
  }

  handleMouseOrTouchUp(ray, isTouch?) {
    if (this.state.delta) {
      // save positions
      CircleOps.executeCommand("move", this.state.circles, null, this.state.delta);
    }
    this.setState({
      mouseIsDown: false,
      draggedCircleIndex: -1,
      delta: null
    })
  }

  onMouseUp(ray: Ray) {
    this.handleMouseOrTouchUp(ray);
  }

  onTouchEnd(ray: Ray) {
    this.handleMouseOrTouchUp(ray, true);
  }

  handleMouseOrTouchMove(ray: Ray, isTouch?) {
    var self = this,
      position = ray.position;

    // nothing to do here
    if (!this.state.mouseIsDown) {
      return;
    }

    // Alt + mouse move = new circle
    if (!isTouch && ray.e.altKey && ray.intersects(this.rootRef.current)) {
      this.setState(
        {
          mousePosition: position,
        },
        function() {
          self.executeCommand("new-circle");
        },
      );
      return;
    }

    // clicking and dragging a single circle moves all the circles
    if (this.state.draggedCircleIndex > -1) {
      this.setState({
        delta: Point.fromObject(position).subtract(this.state.dragOrigin),
      });
    }
  }

  onMouseMove(ray: Ray) {
    this.handleMouseOrTouchMove(ray);
  }

  onTouchMove(ray: Ray) {
    var touch = ray.e.changedTouches[0];

    ray.position = {
      x: touch.clientX,
      y: touch.clientY,
    };
    this.handleMouseOrTouchMove(ray, true);

    // don't bounce the screen on iOS
    ray.preventDefault();
  }

  onClick(ray: Ray) {
    var self = this;

    if (ray.intersectsId(NEW_BUTTON_ID)) {
      self.executeCommand("random-circle");
    }
    
    else if (ray.intersectsId(CLEAR_BUTTON_ID)) {
      self.executeCommand("clear");
    } 

    else if (ray.intersectsId(OPEN_BUTTON_ID)) {
      self.setState({
        popupVisible: EXAMPLE_POPUP_ID,
      });
    }

    else if (ray.intersectsId(CLOSE_BUTTON_ID)) {
      self.setState({
        popupVisible: false,
      });
    }

    else if (ray.intersectsId(GITHUB_BUTTON_ID)) {
      window.open(GITHUB_URL, "_blank");
    }

    else if (ray.intersectsId(STAR_BUTTON_ID)) {
      window.open(STARS_URL, "_blank");
    }
  }


  onKeyDown(ray: Ray) {
    if (ray.e.key === "Escape") {
      // stop dragging circles
      this.setState({
        draggedCircleIndex: -1,
        delta: null,
      });
    }
  }

  onKeyUp(ray: Ray) {
    if (ray.e.key === "Escape") {
      // close the popup
      this.setState({
        popupVisible: false,
      });
    }
  }

  selectCircle(circleElement) {
    //@ts-ignore
    //this.state.selectedCircleIndex = getCircleId(circleElement);

    this.setState({selectedCircleIndex: getCircleId(circleElement)});
  }

  selectCircleOnTop() {
    this.setState({
      selectedCircleIndex: this.state.circles.length - 1,
    });
  }

  executeCommand(command) {
    var position, circles;
    position = this.state.mousePosition;
    circles = CircleOps.executeCommand(command, this.state.circles, this.state.selectedCircleIndex, position);
    this.setState({circles});
  }
  //</editor-fold>

  //<editor-fold desc="React">
  render() {
    var self = this,
      delta = self.state.delta,
      index = 0,
      circles = this.state.circles.map(function(item) {
        var id = CIRCLE_ID_PREFIX + index,
          coords,
          circle;

        if (delta) {
          coords = Point.fromObject(item)
            .add(delta)
            .toObject();
        }

        circle = (
          <Circle
            {...item}
            {...coords}
            id={id}
            key={id}
            strokeColor="white"
            hovered={self.state.hoveredCircleIndex === index}
            selected={self.state.selectedCircleIndex === index}
          />
        );

        index++;
        return circle;
      }),
      popup =
        (this.state.popupVisible === ABOUT_POPUP_ID && <AboutPopup />) ||
        (this.state.popupVisible === EXAMPLE_POPUP_ID && <ExamplePopup />),
      cursorOverlay = this.state.mouseIsDown && !this.state.isTouch && this.state.draggedCircleIndex > -1 && <CursorOverlay />;

    return (
      <div ref={this.rootRef}>
        <div ref={this.canvasRef} className="container">
          <Logo />
          <Svg width="100%" height="100%">
            {circles}
          </Svg>
          <TextRotator />
        </div>
        <BottomToolbar />
        {popup}
        {cursorOverlay}
      </div>
    );
  }
}
