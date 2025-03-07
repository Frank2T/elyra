/*
 * Copyright 2018-2022 Elyra Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { MetadataService, IDictionary, RequestHandler } from '@elyra/services';
import { RequestErrors } from '@elyra/ui-components';

import { showDialog, Dialog } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';

import * as React from 'react';

export const KFP_SCHEMA = 'kfp';
export const RUNTIMES_SCHEMASPACE = 'runtimes';
export const RUNTIME_IMAGES_SCHEMASPACE = 'runtime-images';
export const COMPONENT_CATALOGS_SCHEMASPACE = 'component-catalogs';

export interface IRuntime {
  name: string;
  display_name: string;
  schema_name: string;
  metadata: {
    runtime_type: string;
  };
}

export interface ISchema {
  name: string;
  title: string;
  runtime_type: string;
}

enum ContentType {
  notebook = 'execute-notebook-node',
  python = 'execute-python-node',
  r = 'execute-r-node',
  other = 'other'
}

const CONTENT_TYPE_MAPPER: Map<string, ContentType> = new Map([
  ['.py', ContentType.python],
  ['.ipynb', ContentType.notebook],
  ['.r', ContentType.r]
]);

export interface IRuntimeType {
  id: string;
  display_name: string;
  icon: string;
  export_file_types: { id: string; display_name: string }[];
}

export class PipelineService {
  /**
   * Returns a list of resources corresponding to each active runtime-type.
   */
  static async getRuntimeTypes(): Promise<IRuntimeType[]> {
    const res = await RequestHandler.makeGetRequest(
      'elyra/pipeline/runtimes/types'
    );
    return res.runtime_types.sort((a: any, b: any) => a.id.localeCompare(b.id));
  }

  /**
   * Returns a list of external runtime configurations available as
   * `runtimes metadata`. This is used to submit the pipeline to be
   * executed on these runtimes.
   */
  static async getRuntimes(): Promise<any> {
    return MetadataService.getMetadata(RUNTIMES_SCHEMASPACE);
  }

  /**
   * Returns a list of runtime schema
   */
  static async getRuntimesSchema(showError = true): Promise<any> {
    return MetadataService.getSchema(RUNTIMES_SCHEMASPACE).then(schema => {
      if (showError && Object.keys(schema).length === 0) {
        return RequestErrors.noMetadataError('schema');
      }

      return schema;
    });
  }

  /**
   * Return a list of configured docker images that are used as runtimes environments
   * to run the pipeline nodes.
   */
  static async getRuntimeImages(): Promise<any> {
    try {
      let runtimeImages = await MetadataService.getMetadata('runtime-images');

      runtimeImages = runtimeImages.sort(
        (a: any, b: any) => 0 - (a.name > b.name ? -1 : 1)
      );

      if (Object.keys(runtimeImages).length === 0) {
        return RequestErrors.noMetadataError('runtime image');
      }

      const images: IDictionary<string> = {};
      for (const image in runtimeImages) {
        const imageName: string =
          runtimeImages[image]['metadata']['image_name'];
        images[imageName] = runtimeImages[image]['display_name'];
      }
      return images;
    } catch (error) {
      Promise.reject(error);
    }
  }

  /**
   * Creates a Dialog for passing to makeServerRequest
   */
  static getWaitDialog(
    title = 'Making server request...',
    body = 'This may take some time'
  ): Dialog<any> {
    return new Dialog({
      title: title,
      body: body,
      buttons: [Dialog.okButton()]
    });
  }

  /**
   * Submit the pipeline to be executed on an external runtime (e.g. Kbeflow Pipelines)
   *
   * @param pipeline
   * @param runtimeName
   */
  static async submitPipeline(
    pipeline: any,
    runtimeName: string
  ): Promise<any> {
    return RequestHandler.makePostRequest(
      'elyra/pipeline/schedule',
      JSON.stringify(pipeline),
      this.getWaitDialog('Packaging and submitting pipeline ...')
    ).then(response => {
      let dialogTitle;
      let dialogBody;
      if (response['run_url']) {
        // pipeline executed remotely in a runtime of choice
        dialogTitle = 'Job submission to ' + runtimeName + ' succeeded';
        dialogBody = (
          <p>
            {response['platform'] === 'APACHE_AIRFLOW' ? (
              <p>
                Apache Airflow DAG has been pushed to the{' '}
                <a
                  href={response['git_url']}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Git repository.
                </a>
                <br />
              </p>
            ) : null}
            Check the status of your job at{' '}
            <a
              href={response['run_url']}
              target="_blank"
              rel="noopener noreferrer"
            >
              Run Details.
            </a>
            <br />
            The results and outputs are in the {
              response['object_storage_path']
            }{' '}
            working directory in{' '}
            <a
              href={response['object_storage_url']}
              target="_blank"
              rel="noopener noreferrer"
            >
              object storage
            </a>
            .
          </p>
        );
      } else {
        // pipeline executed in-place locally
        dialogTitle = 'Job execution succeeded';
        dialogBody = (
          <p>Your job has been executed in-place in your local environment.</p>
        );
      }

      return showDialog({
        title: dialogTitle,
        body: dialogBody,
        buttons: [Dialog.okButton()]
      });
    });
  }

  /**
   * Export a pipeline to different formats (e.g. DSL, YAML, etc). These formats
   * are understood by a given runtime.
   *
   * @param pipeline
   * @param pipeline_export_format
   * @param pipeline_export_path
   * @param overwrite
   */
  static async exportPipeline(
    pipeline: any,
    pipeline_export_format: string,
    pipeline_export_path: string,
    overwrite: boolean
  ): Promise<any> {
    console.log(
      'Exporting pipeline to [' + pipeline_export_format + '] format'
    );

    console.log('Overwriting existing file: ' + overwrite);

    const body = {
      pipeline: pipeline,
      export_format: pipeline_export_format,
      export_path: pipeline_export_path,
      overwrite: overwrite
    };

    return RequestHandler.makePostRequest(
      'elyra/pipeline/export',
      JSON.stringify(body),
      this.getWaitDialog('Generating pipeline artifacts ...')
    ).then(response => {
      return showDialog({
        title: 'Pipeline export succeeded',
        body: <p>Exported file: {response['export_path']} </p>,
        buttons: [Dialog.okButton()]
      });
    });
  }

  static getNodeType(filepath: string): string {
    const extension: string = PathExt.extname(filepath);
    const type: string = CONTENT_TYPE_MAPPER.get(extension)!;

    // TODO: throw error when file extension is not supported?
    return type;
  }

  /**
   * Check if a given file is allowed to be added to the pipeline
   * @param item
   */
  static isSupportedNode(file: any): boolean {
    if (PipelineService.getNodeType(file.path)) {
      return true;
    } else {
      return false;
    }
  }

  static getPipelineRelativeNodePath(
    pipelinePath: string,
    nodePath: string
  ): string {
    const relativePath: string = PathExt.relative(
      PathExt.dirname(pipelinePath),
      nodePath
    );
    return relativePath;
  }

  static getWorkspaceRelativeNodePath(
    pipelinePath: string,
    nodePath: string
  ): string {
    // since resolve returns an "absolute" path we need to strip off the leading '/'
    const workspacePath: string = PathExt.resolve(
      PathExt.dirname(pipelinePath),
      nodePath
    );
    return workspacePath;
  }

  static setNodePathsRelativeToWorkspace(
    pipeline: any,
    pipelinePath: string
  ): any {
    for (const node of pipeline.nodes) {
      if (
        node.op === 'execute-notebook-node' ||
        node.op === 'execute-python-node' ||
        node.op === 'execute-r-node'
      ) {
        node.app_data.component_parameters.filename = this.getWorkspaceRelativeNodePath(
          pipelinePath,
          node.app_data.component_parameters.filename
        );
      }
    }
    return pipeline;
  }
}
