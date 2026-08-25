# Third-party notices

## React and React DOM

React and React DOM are copyright Meta Platforms, Inc. and affiliates and are distributed under the following MIT License:

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Container runtime components

- nginx, copyright Nginx, Inc. and contributors, BSD 2-Clause License.
- Alpine Linux packages retain their respective open-source licenses; package license metadata is included in the image.

## Development and build tooling

Development/build/test dependencies and GitHub Actions are listed in `package-lock.json` and `.github/workflows/validate-and-publish.yml`. They are not loaded by the browser at runtime. Full license texts are available from the corresponding package distributions and upstream projects.

Playwright Test and its Chromium automation tooling are used only for development/CI runtime smoke testing and are licensed under Apache-2.0. `@axe-core/playwright` is used only for automated accessibility smoke testing and is licensed under MPL-2.0. Neither is loaded by the production browser application.
