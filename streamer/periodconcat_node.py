# Copyright 2019 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Concatenates inputs into periods by creating a master DASH/HLS file."""

import os
import re
from typing import List, Tuple
from xml.etree import ElementTree
from streamer import __version__
from streamer.node_base import NodeBase, ProcessStatus, ThreadedNodeBase
from streamer.transcoder_node import TranscoderNode
from streamer.packager_node import PackagerNode
from streamer.input_configuration import Input
from streamer.pipeline_configuration import PipelineConfig, ManifestFormat, StreamingMode


class PeriodConcatNode(ThreadedNodeBase):
  """A node that concatenates multiple DASH manifests and/or HLS playlists
  when the input is a multiperiod_inputs_list.
  """
  
  def __init__(self,
               pipeline_config: PipelineConfig,
               all_nodes: List[NodeBase],
               outpud_dir: str) -> None:
    """Stores all relevant information needed for the period concatenation."""
    super().__init__(thread_name='periodconcat', continue_on_exception=False, sleep_time=3)
    self._pipeline_config = pipeline_config
    self._output_dir = outpud_dir
    
    self._period_inputs_list: List[List[Input]] = []
    # When iterating with enumeruate(List[NodeBase]) each single index will point
    # to one TranscoderNode and its corresponding PackagerNode in each of these lists.
    self._transcoder_nodes: List[TranscoderNode] = []
    self._packager_nodes: List[PackagerNode] = []
    
    # We don't need to save CloudNode(s) or ExternalCommandNode(s).
    # We will start the concatenation once all the PackagerNode(s) are finished.
    for node in all_nodes:
      if isinstance(node, TranscoderNode):
        self._transcoder_nodes.append(node)
        self._period_inputs_list.append(node._inputs)
      elif isinstance(node, PackagerNode):
        self._packager_nodes.append(node)
  
  def _thread_single_pass(self) -> None:
    """Watches all the PackagerNode(s), if at least one of them is running it skips this
    _thread_single_pass, if all of them are finished, it starts period concatenation, if one of
    them is errored, it raises a RuntimeError.
    """
    
    for i, packager_node in enumerate(self._packager_nodes):
      status: ProcessStatus = packager_node.check_status()
      if status == ProcessStatus.Running:
        return
      elif status == ProcessStatus.Errored:
        raise RuntimeError(
          "PeriodConcatNode: 'PackagerNode#{} Errored, Concatenation is stopped.'".format(i)
        )
    
    if(ManifestFormat.DASH in self._pipeline_config.manifest_format):
      self._dash_concat()
      
    if(ManifestFormat.HLS in self._pipeline_config.manifest_format):
      self._hls_concat()
    
    self._status = ProcessStatus.Finished
  
  def _dash_concat(self) -> None:
    """Concatenates multiple single-period DASH manifests into one multi-period DASH manifest."""
    
    class ISO8601:
      """A helper class represeting the iso8601:2004 duration format."""
      
      def __init__(self, years=0, months=0, days=0,
                   hours=0, minutes=0, seconds=0):
        
        self.years: int = years
        self.months: int = months
        self.days: int = days
        self.hours: int = hours
        self.minutes: int = minutes
        self.seconds: float = seconds
        
      @staticmethod
      def parse(duration: str) -> 'ISO8601':
        """Converts duration from iso8601 format to native python data-types."""
        
        pattern = ('^P(?:([0-9]*)Y)?(?:([0-9]*)M)?(?:([0-9]*)D)?'
                   '(?:T(?:([0-9]*)H)?(?:([0-9]*)M)?(?:([0-9.]*)S)?)?$')
        matches = re.search(pattern, duration)
        assert matches is not None, "ISO8601: Duration parsing failed."
        
        groups = [int(match) for match in matches.groups('0')[:5]]
        seconds = float(matches.groups('0')[5])
        
        return ISO8601(groups[0], groups[1], groups[2],
                       groups[3], groups[4], seconds)
      
      def __str__(self) -> str:
        """Return the duration in iso8601 format."""
        
        return "P{}Y{}M{}DT{}H{}M{}S".format(self.years, self.months, self.days,
                                             self.hours, self.minutes, self.seconds)
      
      def __add__(self, other: 'ISO8601') -> 'ISO8601':
        """Addes two iso8601 time durations together, and returns their sum.
        Since each time container is not limited by when it overflows (ie, we can have 61S or 36H
        this format doesn't limit us to 59.99S or 23H), we can perform a simple addition between
        matching containers."""
        
        return ISO8601(
          self.years + other.years,
          self.months + other.months,
          self.days + other.days,
          self.hours + other.hours,
          self.minutes + other.minutes,
          self.seconds + other.seconds)
      
      def __iadd__(self, other: 'ISO8601') -> 'ISO8601':
        return self + other
    
    dash_namespace = 'urn:mpeg:dash:schema:mpd:2011'
    
    def find(elem: ElementTree.Element, *args: str) -> ElementTree.Element:
      """A better interface for the Element.find() method.
      Use it only if it is guaranteed that the element we are searching for is inside,
      Otherwise it will raise an AssertionError."""
      full_path = ''
      for tag in args:
        full_path+='{'+dash_namespace+'}'+tag+'/'
      child_elem =  elem.find(full_path[:-1])
      # elem.find() returns either an ElementTree.Element or None.
      assert child_elem is not None
      return child_elem
    
    def findall(elem: ElementTree.Element, *args: str) -> List[ElementTree.Element]:
      """A better interface for the Element.findall() method"""
      full_path = ''
      for tag in args:
        full_path+='{'+dash_namespace+'}'+tag+'/'
      return elem.findall(full_path[:-1])
    
    # We will add the time of each period on this container to set that time later
    # as 'mediaPresentationDuration' for the MPD tag for VOD.
    # For LIVE we will use this object to determine the start time of the next period.
    total_time: ISO8601 = ISO8601()
    
    # Periods that are going to be collected from different MPD files.
    periods: List[ElementTree.Element] = []
    
    # Get an MPD file that we will concatenate periods into.
    ref_mpd = ElementTree.ElementTree(file=os.path.join(
      self._packager_nodes[0]._output_dir,
      self._pipeline_config.dash_output)).getroot()
    
    # Remove the Period element in that MPD.
    ref_mpd.remove(find(ref_mpd, 'Period'))
    
    for i, packager_node in enumerate(self._packager_nodes):
      
      dash_file_path = os.path.join(
        packager_node._output_dir,
        self._pipeline_config.dash_output)
      
      mpd = ElementTree.ElementTree(file=dash_file_path).getroot()
      period = find(mpd, 'Period')
      
      period.attrib['id'] = str(i)
      
      if self._pipeline_config.streaming_mode == StreamingMode.VOD:
        # For VOD, use the 'mediaPresentationDuration' to set the Period duration.
        period.attrib['duration'] = mpd.attrib['mediaPresentationDuration']
        total_time += ISO8601.parse(period.attrib['duration'])
      else:
        # For LIVE, set the start attribute.
        period.attrib['start'] = str(total_time)
        #total_time += ISO8601.parse(period.attrib['where to get the period time from???'])
        
      # For multi segment media
      for segment_template in findall(
        period,
        'AdaptationSet',
        'Representation',
        'SegmentTemplate'):
        path_to_segement = os.path.relpath(packager_node._output_dir, self._output_dir)
        
        if segment_template.attrib.get('initialization'):
          segment_template.attrib['initialization'] = os.path.join(
            path_to_segement,
            segment_template.attrib['initialization']
          )
          
        if segment_template.attrib.get('media'):
          segment_template.attrib['media'] = os.path.join(
            path_to_segement,
            segment_template.attrib['media']
          )
      
      # For single segment media
      for base_url in findall(
        period,
        'AdaptationSet',
        'Representation',
        'BaseURL'):
        path_to_segement = os.path.relpath(packager_node._output_dir, self._output_dir)
        
        assert base_url.text is not None, 'No media file found for the single segment ' + dash_file_path # For mypy's static analysis
        base_url.text = os.path.join(
          path_to_segement,
          base_url.text
        )
        
      periods.append(period)
    
    # Add the periods collected from all the files.
    ref_mpd.extend(periods)
    
    # Update total duration for vod.
    if self._pipeline_config.streaming_mode == StreamingMode.VOD:
      ref_mpd.attrib['mediaPresentationDuration'] = str(total_time)
    
    # Remove the placeholder namespace put by the module and set it to be the default namespace.
    ElementTree.register_namespace('', dash_namespace)
    
    
    # Write the period concat to the outpud_dir.
    with open(os.path.join(
        self._output_dir,
        self._pipeline_config.dash_output), 'w') as master_dash:
      contents = "<?xml version='1.0' encoding='UTF-8'?>\n"
      contents += "<!--Generated with https://github.com/google/shaka-packager -->\n"
      contents += "<!--Made Multi-Period with https://github.com/google/shaka-streamer version {} -->\n".format(__version__)
      # xml.etree.ElementTree already have an ElementTree().write() method,
      # but it won't allow putting comments at the begining of the file.
      contents += ElementTree.tostring(element=ref_mpd, encoding="unicode")
      master_dash.write(contents)
      
    
  def _hls_concat(self) -> None:
    """Concatenates multiple HLS playlists with #EXT-X-DISCONTINUITY."""
    
    import m3u8 # type: ignore
    