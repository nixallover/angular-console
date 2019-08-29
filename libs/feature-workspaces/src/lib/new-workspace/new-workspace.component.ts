import { Directory } from '@angular-console/schema';
import { schematicFieldsToFormGroup } from '@angular-console/ui';
import {
  CommandRunner,
  CommandStatus,
  IncrementalCommandOutput,
  Serializer,
  Telemetry
} from '@angular-console/utils';
import {
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  ViewEncapsulation,
  OnInit,
  OnDestroy
} from '@angular/core';
import {
  AbstractControl,
  AsyncValidatorFn,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { MatHorizontalStepper } from '@angular/material';
import { Router, NavigationEnd } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, combineLatest } from 'rxjs';
import {
  map,
  publishReplay,
  refCount,
  switchMap,
  take,
  tap,
  filter,
  takeUntil
} from 'rxjs/operators';

import {
  NgNew,
  NgNewGQL,
  SchematicCollections,
  SchematicCollectionsGQL
} from '../generated/graphql';
import { WorkspacesService } from '../workspaces.service';
import { ContextualActionBarService } from '@nrwl/angular-console-enterprise-frontend';
import { WorkspaceTemplate, WORKSPACE_TEMPLATES } from './workspace-templates';

interface SchematicCollectionForNgNew {
  name: string;
  description: string;
}

/**
 * Update notes:
 * Add autofocus back
 * Vertical stepper (instead of doing it manually)
 * Move workspace templates to the backend
 * Get the actual template data
 * Automatically track
 *
 */

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  selector: 'angular-console-new-workspace',
  templateUrl: './new-workspace.component.html',
  styleUrls: ['./new-workspace.component.scss']
})
export class NewWorkspaceComponent implements OnInit, OnDestroy {
  @ViewChild(MatHorizontalStepper, { static: false })
  stepper: MatHorizontalStepper;

  destroyed$ = new Subject();

  templates: WorkspaceTemplate[] = WORKSPACE_TEMPLATES;
  commandOutput$?: Observable<IncrementalCommandOutput>;
  selectedTemplate: WorkspaceTemplate | null;
  images = {
    '@schematics/angular': 'angular-logo.png',
    '@nrwl/workspace': 'nx-logo.png'
  };
  configurationCompleted = false;

  command?: string;

  ngNewForm = this.fb.group({
    path: this.fb.control(null, Validators.required),
    name: this.fb.control(
      null,
      Validators.required,
      makeNameAvailableValidator()
    ),
    collection: this.fb.control(null, Validators.required)
  });

  schematicCollectionsForNgNew$ = this.schematicCollectionsGQL.fetch().pipe(
    map(r =>
      r.data.schematicCollections.map(collection => ({
        ...collection,
        schema: collection.schema.filter(
          s => s.name !== 'name' && s.name !== 'directory'
        )
      }))
    ),
    publishReplay(1),
    refCount()
  );

  templates$ = combineLatest([
    this.schematicCollectionsForNgNew$,
    of(this.templates)
  ]).pipe(
    map(([schematicCollections, templates]) => {
      return templates.map(t => ({
        ...t,
        schematic: schematicCollections.find(s => s.name === t.schematicSet)
      }));
    })
  );

  // autofocusInput() {
  //   const autofocus = (this.elementRef
  //     .nativeElement as HTMLElement).querySelectorAll('.autofocus')[
  //     this.verticalStepper.selectedIndex
  //   ] as any;

  //   if (autofocus && autofocus.focus) {
  //     autofocus.focus();
  //   }
  // }

  constructor(
    private readonly telemetry: Telemetry,
    // private readonly elementRef: ElementRef,
    private readonly router: Router,
    private readonly fb: FormBuilder,
    private readonly schematicCollectionsGQL: SchematicCollectionsGQL,
    private readonly workspacesService: WorkspacesService,
    private readonly contextualActionBarService: ContextualActionBarService,
    private readonly ngNewGQL: NgNewGQL,
    private readonly serializer: Serializer,
    private readonly commandRunner: CommandRunner
  ) {
    router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroyed$)
      )
      .subscribe(e => {
        if (e.urlAfterRedirects === '/create-workspace') {
          this.contextualActionBarService.breadcrumbs$.next([
            { title: 'Create a workspace' }
          ]);
        }
      });
  }

  ngOnInit() {
    this.telemetry.screenViewed('New Workspace');
  }

  selectTemplate(template?: WorkspaceTemplate) {
    if (template) {
      this.selectedTemplate = template;
      this.ngNewForm.controls.collection.setValue(template.schematic);

      const value: SchematicCollections.SchematicCollections | null =
        template.schematic;
      this.ngNewForm.removeControl('collectionOptions');

      if (value && value.schema) {
        const formGroup = schematicFieldsToFormGroup({
          fields: value.schema as any,
          selectedConfiguration: null
        });

        this.ngNewForm.addControl('collectionOptions', formGroup);
      }

      this.stepper.next();
    } else {
      this.selectedTemplate = null;
      this.ngNewForm.controls.collection.setValue(null);
      this.ngNewForm.removeControl('collectionOptions');
    }
  }

  unselectTemplate() {
    this.selectTemplate(undefined);
  }

  selectParentDirectory() {
    this.workspacesService
      .selectDirectoryForNewWorkspace()
      .subscribe(result => {
        if (result && result.selectedDirectoryPath) {
          this.ngNewForm.controls.path.setValue(result.selectedDirectoryPath);
        }
      });
  }

  createNewWorkspace() {
    if (this.ngNewForm.valid) {
      const ngNewInvocation: NgNew.Variables = {
        collection: this.ngNewForm.value.collection.name,
        name: this.ngNewForm.value.name,
        path: this.ngNewForm.value.path,
        newCommand: this.serializer.serializeArgs(
          this.ngNewForm.controls.collectionOptions.value,
          this.ngNewForm.controls.collection.value.schema
        )
      };

      this.command = `ng new ${ngNewInvocation.name} --directory=${
        ngNewInvocation.name
      } --collection=${
        ngNewInvocation.collection
      } ${ngNewInvocation.newCommand.join(' ')}`;
      this.commandOutput$ = this.commandRunner
        .runCommand(
          this.ngNewGQL.mutate(ngNewInvocation),
          false,
          new BehaviorSubject(80)
        )
        .pipe(
          tap(command => {
            if (command.status === CommandStatus.SUCCESSFUL) {
              // this.dialogRef.close();
              this.router.navigate([
                '/workspace',
                `${ngNewInvocation.path}/${ngNewInvocation.name}`,
                'projects'
              ]);
            }
          })
        );
    }
  }

  trackByName(_: number, collection: SchematicCollectionForNgNew) {
    return collection.name;
  }

  ngOnDestroy() {
    this.destroyed$.next();
    this.destroyed$.complete();
  }
}

export function makeNameAvailableValidator(): AsyncValidatorFn {
  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    const form = control.parent as FormGroup;
    const pathCtrl = form.controls.path;
    const nameCtrl = form.controls.name;

    return of(
      nameCtrl && pathCtrl ? `${pathCtrl.value}/${nameCtrl.value}` : null
    ).pipe(
      switchMap(
        // TODO(mrmeku): Recompute this with a less expensive call.
        (_: null | string): Observable<null | Directory> => of(null)
      ),
      map((d: null | Directory) =>
        !d || !d.exists ? null : { nameTaken: true }
      ),
      take(1)
    );
  };
}
