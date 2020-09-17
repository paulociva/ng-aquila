import { coerceBooleanProperty, BooleanInput } from '@angular/cdk/coercion';
import {
  ConnectedPosition,
  ConnectionPositionPair,
  FlexibleConnectedPositionStrategy,
  Overlay,
  OverlayConfig,
  OverlayRef,
  PositionStrategy
} from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
  AfterViewInit,
  Directive,
  ElementRef,
  EmbeddedViewRef,
  EventEmitter,
  Inject,
  Input,
  OnDestroy,
  OnInit,
  Optional,
  Output,
  ViewContainerRef,
  NgZone
} from '@angular/core';
import { EventManager } from '@angular/platform-browser';
import { fromEvent, Observable, Subject } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { FocusMonitor } from '@angular/cdk/a11y';
import { NxPopoverComponent } from './popover.component';
import { FocusTrapFactory, FocusTrap } from '@angular/cdk/a11y';
import { DOCUMENT } from '@angular/common';
import { Platform } from '@angular/cdk/platform';
import { SPACE, ENTER } from '@angular/cdk/keycodes';
import { Directionality } from '@angular/cdk/bidi';

export declare type PopoverDirection = 'left' | 'top' | 'right' | 'bottom';
export declare type PopoverTriggerType = 'click' | 'hover' | 'manual';
export declare type PopoverTriggerScrollStrategy = 'close' | 'reposition';
let nextId = 0;

const fallbacks: ConnectionPositionPair[] = [
  {
    originX: 'start',
    originY: 'bottom',
    overlayX: 'start',
    overlayY: 'top',
    offsetX: 0,
    offsetY: 16
  },
  {
    originX: 'end',
    originY: 'top',
    overlayX: 'end',
    overlayY: 'bottom',
    offsetX: 0,
    offsetY: -16
  },
  {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetX: 0,
    offsetY: 16
  },
  {
    originX: 'end',
    originY: 'bottom',
    overlayX: 'end',
    overlayY: 'top',
    offsetX: 0,
    offsetY: 16
  },
  {
    originX: 'end',
    originY: 'center',
    overlayX: 'start',
    overlayY: 'center',
    offsetX: 16,
    offsetY: 0
  },
  {
    originX: 'start',
    originY: 'center',
    overlayX: 'end',
    overlayY: 'center',
    offsetX: -16,
    offsetY: 0
  },
  {
    originX: 'center',
    originY: 'top',
    overlayX: 'center',
    overlayY: 'bottom',
    offsetX: 0,
    offsetY: -16
  },
  {
    originX: 'start',
    originY: 'top',
    overlayX: 'start',
    overlayY: 'bottom',
    offsetX: 0,
    offsetY: -16
  }
];

@Directive({
  selector: '[nxPopoverTriggerFor]',
  exportAs: 'nxPopoverTrigger',
  host: {
    '(click)': 'handleClick()',
    'aria-haspopup': 'true',
    '[attr.aria-expanded]': 'isOpen',
    '[attr.aria-describedby]': 'isOpen ? id : null'
  }
})
export class NxPopoverTriggerDirective implements AfterViewInit, OnDestroy, OnInit {
  private overlayRef: OverlayRef;
  private portal: TemplatePortal<any>;
  private _destroyed = new Subject<void>();
  private _show: boolean = false;
  private _closeable: boolean = null;
  private _positionStrategy: PositionStrategy;
  private _embeddedViewRef: EmbeddedViewRef<any>;
  private _documentClickObservable: Observable<MouseEvent>;
  private _modal: boolean = false;
  /** The class that traps and manages focus within the popover. */
  private _focusTrap: FocusTrap;
  /** Element that was focused before the Popover was opened. Save this to restore upon close. */
  private _elementFocusedBeforePopoverWasOpened: HTMLElement | null = null;
  private _manualListeners = new Map<string, EventListenerOrEventListenerObject>();
  /** @docs-private */
  id = 'nx-popover-' + nextId++;

  /** An event is emitted if the visibility status of the popover changes. */
  @Output('nxPopoverShowChange')
  changeShow: EventEmitter<boolean> = new EventEmitter();

  /** Whether to show or hide the popover. */
  @Input('nxPopoverShow')
  set show(value: boolean) {
    value = coerceBooleanProperty(value);
    if (this._show !== value) {
      this._show = value;
      if (this._show) {
        this.openPopover();
      } else {
        this.closePopover();
      }
    }
  }

  get show() {
    return this._show;
  }

  /** Whether to show a close button. By default a close icon is only shown for trigger type click. */
  @Input('nxPopoverCloseable')
  set closeable(value: boolean) {
    this._closeable = coerceBooleanProperty(value);

    if (this.popover) {
      this.popover.showCloseButton = this.isCloseable();
    }
  }
  get closeable(): boolean {
    return this._closeable;
  }

  /** Whether the popover should be closed on click outside of the popover in the trigger modes 'manual' and 'click'. */
  @Input()
  set closeOnClickOutside(value: boolean) {
    this._closeOnClickOutside = coerceBooleanProperty(value);
  }
  get closeOnClickOutside(): boolean {
    return this._closeOnClickOutside;
  }

  private _closeOnClickOutside: boolean = true;

  /** Links the trigger with the popover to open. */
  @Input('nxPopoverTriggerFor')
  popover: NxPopoverComponent;

  /** Sets the desired direction to open the popover. E.g., right, left, bottom, top */
  @Input('nxPopoverDirection')
  direction: PopoverDirection = 'right';

  /** Whether the popover will be opened automatically. */
  @Input('nxPopoverInitialVisible')
  popoverInitialVisible: boolean = false;

  /** An event is emitted when the visibility of the popopver changes. */
  @Input('nxPopoverVisibleChange')
  visibleChange: EventEmitter<boolean> = new EventEmitter();

  /** Whether the popover opens in modal state. */
  @Input('nxPopoverModal')
  set modal(value: boolean) {
    this._modal = coerceBooleanProperty(value);
  }
  get modal(): boolean {
    return this._modal;
  }

  // If nxPopoverTrigger equals to 'hover' the popover opens on mouseenter and closes on mouseout.
  // If nxPopoverTrigger equals to 'click' the popover opens on click and closes on a click of the close icon or pressing ESC key.
  // If nxPopoverTrigger equals to 'manual' the popover opens only when programatically requested.
  /** Sets the way to trigger the popover. Options are hover, click, manual */
  @Input('nxPopoverTrigger')
  trigger: PopoverTriggerType = 'click';

  /** Sets the scroll strategy. 'close' closes the popover on scroll while 'reposition' scrolls the popover with the origin. */
  @Input('nxPopoverScrollStrategy')
  scrollStrategy: PopoverTriggerScrollStrategy = 'close';

  constructor(private overlay: Overlay,
              private elementRef: ElementRef,
              private viewContainerRef: ViewContainerRef,
              private eventManager: EventManager,
              private _focusTrapFactory: FocusTrapFactory,
              private _focusMonitor: FocusMonitor,
              private _ngZone: NgZone,
              private _platform: Platform,
              @Optional() private _dir: Directionality,
              @Optional() @Inject(DOCUMENT) private _document: any) {
    this._documentClickObservable = fromEvent<MouseEvent>(document, 'click');
    const element: HTMLElement = elementRef.nativeElement;
    if (!this._platform.IOS && !this._platform.ANDROID) {
      this._manualListeners
        .set('mouseenter', () => {
          if (this.trigger === 'hover') {
            this.show = true;
          }
        })
        .set('mouseleave', () => {
          if (this.trigger === 'hover') {
            this.show = false;
          }
        })
        .set('keydown', (event: KeyboardEvent) => {
          switch (event.keyCode) {
            case SPACE:
            case ENTER:
              this.handleClick();
              break;
            default:
              return;
          }
        });
    } else {
      this._manualListeners.set('touchstart', () => {
        if (this.trigger === 'hover') {
          this.show = true;
        }
      });
    }

    this._manualListeners.forEach((listener, event) => element.addEventListener(event, listener));

    this._focusMonitor.monitor(element).pipe(takeUntil(this._destroyed)).subscribe(origin => {
      if (origin === 'keyboard' && this.trigger === 'hover') {
        this._ngZone.run(() => this.show = true);
      }
    });
  }

  ngOnInit() {
    this.popover.showCloseButton = this.isCloseable();
  }

  ngAfterViewInit(): void {
    this.popover.id = this.id;

    this.eventManager.addGlobalEventListener('window', 'keyup.esc', () => {
      if (this.isOpen) {
        this.show = false;
      }
    });

    this.popover.closeButtonClick.pipe(takeUntil(this._destroyed)).subscribe(() => {
      this.show = false;
    });

    if (this.popoverInitialVisible || this._show) {
      this.show = true;
    }
  }

  ngOnDestroy(): void {
    this.show = false;
    // Clean up the event listeners set in the constructor
    this._manualListeners.forEach((listener, event) => {
      this.elementRef.nativeElement.removeEventListener(event, listener);
    });
    this._manualListeners.clear();
    this._destroyed.next();
    this._destroyed.complete();
  }

  /** @docs-private */
  get isOpen() {
    return this.overlayRef && this.createOverlay().hasAttached();
  }

  /** @docs-private */
  isCloseable() {
    return (this.trigger === 'click' && this._closeable === null) || this._closeable;
  }

  /** Update the popover with the given position strategy. */
  updatePosition() {
    if (this._positionStrategy) {
      this._positionStrategy.apply();
    }
  }

  /** @docs-private */
  handleClick() {
    if (this.trigger === 'click') {
      this.show = !this.isOpen;
    } else if (this.trigger === 'hover') {
      this.show = true;
    }
  }

  /** Open the popover instance. */
  open(): void {
    this.show = true;
  }

  /** Close the popover instance. */
  close(): void {
    this.show = false;
  }

  /** Toggle the popover instance. */
  toggle(): void {
    this.show = !this.show;
  }

  private openPopover(): void {
    if (!this.createOverlay().hasAttached()) {
      this._embeddedViewRef = this.createOverlay().attach(this.portal);

      const element = this._embeddedViewRef.rootNodes[0] as HTMLElement;
      this._focusTrap = this._focusTrapFactory.create(element);
      this._elementFocusedBeforePopoverWasOpened = this.elementRef.nativeElement;
      this._autoFocusFirstTabbableElement(element);

      // attach a close click listener only if it makes sense (ignore it on hover e.g.)
      if (this.shouldReactOnClickOutside()) {
        this.waitForClose();
      }
    }
  }

  /**
   * Autofocus the first tabbable element inside of the popover, if there is not a tabbable element,
   * focus the popover instead.
   */
  private _autoFocusFirstTabbableElement(element: HTMLElement) {
    this._focusTrap.focusInitialElementWhenReady().then(hasMovedFocus => {
      // If we didn't find any focusable elements inside the popover, focus the
      // container so the user can't tab into other elements behind it.
      if (!hasMovedFocus) {
        element.focus();
      }
    });
  }

  private shouldReactOnClickOutside() {
    return (!this._modal && this.closeOnClickOutside);
  }

  // detaches the overlay
  // we are listening to the detachments observable which will then emit the nxClosed event
  // on the popover component
  private closePopover(): void {
    if (this.overlayRef) {
      this._returnFocusAfterPopover();
      this.overlayRef.detach();
      this._embeddedViewRef = null;
      this._focusTrap.destroy();
    }
  }

  private createOverlay(): OverlayRef {
    if (!this.overlayRef) {
      this.portal = new TemplatePortal(this.popover.templateRef, this.viewContainerRef);
      const overlayState = new OverlayConfig();
      overlayState.positionStrategy = this.getPosition();
      this._positionStrategy = overlayState.positionStrategy;

      if (this.scrollStrategy === 'reposition') {
        overlayState.scrollStrategy = this.overlay.scrollStrategies.reposition();
      } else {
        overlayState.scrollStrategy = this.overlay.scrollStrategies.close();
      }

      overlayState.scrollStrategy.enable();

      if (this._modal && this.trigger === 'click') {
        overlayState.hasBackdrop = true;
      }

      this.overlayRef = this.overlay.create(overlayState);
      this.subscribeToPositions(overlayState.positionStrategy as FlexibleConnectedPositionStrategy);
      this._subscribeToAttach();
      this._subscribeToDetach();
      if (this._modal) {
        this._subscribeToBackdropClick();
      }
    }
    return this.overlayRef;
  }

  private subscribeToPositions(position: FlexibleConnectedPositionStrategy): void {
    position.positionChanges.pipe(takeUntil(this._destroyed)).subscribe(change => {
      const pair = change.connectionPair;
      this.positionOverlay(pair);
      this.positionArrow(pair);

      // These position changes arrive too late,
      // We have to trigger the change detection manually
      // as it's detached from any render hierarchy
      // and only updated by the overlay when attached.
      if (this._embeddedViewRef && !this._embeddedViewRef.destroyed) {
        this._embeddedViewRef.detectChanges();
      }
    });
  }

  // for modal popovers close the popover on backdrop clicks
  private _subscribeToBackdropClick() {
    this.overlayRef.backdropClick().pipe(takeUntil(this._destroyed)).subscribe((event) => {
      this.show = false;
    });
  }

  // Emit the nxClosed and the show status change event on the popover component when the overlay detaches
  private _subscribeToDetach() {
    this.overlayRef.detachments().pipe(takeUntil(this._destroyed)).subscribe(data => {
      // This is an exception: when the popover is closed by a scrolling event,
      // then only the detached method is called but the show state variable remains unchanged.
      if (this.show) {
        this.show = false;
      }
      this.changeShow.emit(this._show);
      this.popover.emitClosedEvent();
    });
  }

  private _subscribeToAttach() {
    this.overlayRef.attachments().pipe(takeUntil(this._destroyed)).subscribe(data => {
      this.changeShow.emit(this._show);
    });
  }

  // subscribe to document clicks when trigger='click' to close the popover on clicks on the background
  private waitForClose() {
    return this._documentClickObservable
      .pipe(
        map(event => event.target),
        filter(target => !this.elementRef.nativeElement.contains(target)),
        takeUntil(this.popover.closed))
      .subscribe(() => {
        this.show = false;
      });
  }

  private positionOverlay(pair: ConnectionPositionPair) {
    if (pair.originX === 'end' && pair.overlayX === 'start') {
      this.popover.direction = this.isRtl ? 'left' : 'right';
    } else if (pair.originY === 'bottom' && pair.overlayY === 'top') {
      this.popover.direction = 'bottom';
    } else if (pair.originX === 'start' && pair.overlayX === 'end') {
      this.popover.direction = this.isRtl ? 'right' : 'left';
    } else if (pair.originY === 'top' && pair.overlayY === 'bottom') {
      this.popover.direction = 'top';
    }
  }

  private positionArrow(pair: ConnectionPositionPair) {

    const parentElementPositionX = this.elementRef.nativeElement.getBoundingClientRect().left;
    const parentElementWidth = this.elementRef.nativeElement.getBoundingClientRect().width / 2;
    const parentElementLeftOffset = this.overlayRef.overlayElement.parentElement.offsetLeft;
    const overlayElementLeftOffset = this.overlayRef.overlayElement.offsetLeft;

    // calculation for x position of the parent element. In this case, overlay left offset is the one thing to consider.
    const targetPosition = (parentElementPositionX + parentElementWidth) - (parentElementLeftOffset + overlayElementLeftOffset);
    if (pair.originX === pair.overlayX) {
      const direction = 'left';
      const arrowStyle = {};

      arrowStyle[direction] = targetPosition + 'px';
      this.popover.arrowStyle = arrowStyle;
    }
    if ((pair.originY === 'bottom' || pair.originY === 'top') && pair.overlayX === 'center') {
      this.popover.arrowStyle = { left: targetPosition + 'px' };
    }

    if ((pair.originX === 'end' || pair.originX === 'start') && pair.overlayY === 'center') {
      this.popover.arrowStyle = { top: '50%' };
    }
  }

  private getPosition(): FlexibleConnectedPositionStrategy {
    let positions: ConnectedPosition[];
    let offsetX = 0;
    let offsetY = 0;
    if (this.direction === 'top') {
      positions = [{
        overlayX: 'center',
        overlayY: 'bottom',
        originX: 'center',
        originY: 'top'
      }];
      offsetX = 0;
      offsetY = -20;
    } else if (this.direction === 'right') {
      positions = [{
        overlayX: this.isRtl ? 'end' : 'start',
        overlayY: 'center',
        originX: this.isRtl ? 'start' : 'end',
        originY: 'center'
      }];
      offsetX = 20;
      offsetY = 0;
    } else if (this.direction === 'bottom') {
      positions = [{
        overlayX: 'center',
        overlayY: 'top',
        originX: 'center',
        originY: 'bottom'
      }];
      offsetX = 0;
      offsetY = 20;
    } else if (this.direction === 'left') {
      positions = [{
        overlayX: this.isRtl ? 'start' : 'end',
        overlayY: 'center',
        originX: this.isRtl ? 'end' : 'start',
        originY: 'center'
      }];
      offsetX = -20;
      offsetY = 0;
    }
    return this.overlay.position().flexibleConnectedTo(this.elementRef)
      .withPositions([...positions, ...fallbacks])
      .withDefaultOffsetX(offsetX)
      .withDefaultOffsetY(offsetY);
  }

  /** Returns the focus to the element focused before the Popover was open. */
  private _returnFocusAfterPopover() {
    const toFocus = this._elementFocusedBeforePopoverWasOpened;
    // We need the extra check, because IE can set the `activeElement` to null in some cases.
    if (toFocus && typeof toFocus.focus === 'function') {
      toFocus.focus();
    }
  }

  get isRtl(): boolean {
    return this._dir && this._dir.value === 'rtl';
  }

  static ngAcceptInputType_show: BooleanInput;
  static ngAcceptInputType_closeable: BooleanInput;
  static ngAcceptInputType_closeOnClickOutside: BooleanInput;
  static ngAcceptInputType_modal: BooleanInput;
}